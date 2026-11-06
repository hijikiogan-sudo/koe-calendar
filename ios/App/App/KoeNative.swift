// Koe：iOSの機能（切れないGoogleログイン、声の聞き取り）をWeb側の画面へ渡す部分
import AVFoundation
import AuthenticationServices
import Capacitor
import WebKit
import CryptoKit
import Speech
import UIKit

/// 画面の土台。Koe専用の機能をここで登録する
class KoeBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KoeAuthPlugin())
        bridge?.registerPluginInstance(KoeSpeechPlugin())
        // Macで動くときは、iPad向けの画面が77%に縮小されるので、その分を拡大して元の大きさに戻す
        if ProcessInfo.processInfo.isiOSAppOnMac {
            let source = "document.querySelector('meta[name=viewport]').setAttribute('content','initial-scale=1.3,minimum-scale=1.3,maximum-scale=1.3,viewport-fit=cover')"
            webView?.configuration.userContentController.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
    }
}

// MARK: - キーチェーン（更新用の鍵は、この端末の安全な保管場所にだけ置く）

private enum KoeKeychain {
    static let account = "google-refresh-token"
    static let service = "jp.hijikiogan.koe"

    private static var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func read() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ value: String) {
        delete()
        var query = base
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    static func delete() {
        SecItemDelete(base as CFDictionary)
    }
}

// MARK: - Googleログイン

@objc(KoeAuthPlugin)
public class KoeAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "KoeAuthPlugin"
    public let jsName = "KoeAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
    ]

    private var session: ASWebAuthenticationSession?
    private let tokenURL = URL(string: "https://oauth2.googleapis.com/token")!

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    /// iOS用クライアントIDから、ログイン後にアプリへ戻るための名前を作る（Googleの決まり）
    private func redirectScheme(_ clientId: String) -> String {
        "com.googleusercontent.apps." + clientId.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
    }

    private func randomString() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64url(Data(bytes))
    }

    private func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    @objc func signIn(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId"), !clientId.isEmpty, let scope = call.getString("scope") else {
            call.reject("ログインの設定がありません", "config")
            return
        }
        let scheme = redirectScheme(clientId)
        let redirect = "\(scheme):/oauth2redirect"
        let verifier = randomString()
        let stateValue = randomString()
        let challenge = base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: stateValue),
            URLQueryItem(name: "prompt", value: "consent"),
        ]
        DispatchQueue.main.async {
            let s = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: scheme) { [weak self] url, error in
                guard let self else { return }
                self.session = nil
                if let error {
                    let canceled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    call.reject(canceled ? "やめました" : error.localizedDescription, canceled ? "canceled" : "failed")
                    return
                }
                guard let url, let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                      items.first(where: { $0.name == "state" })?.value == stateValue,
                      let code = items.first(where: { $0.name == "code" })?.value else {
                    call.reject("ログインできませんでした", "failed")
                    return
                }
                self.requestToken(["client_id": clientId, "code": code, "code_verifier": verifier,
                                   "grant_type": "authorization_code", "redirect_uri": redirect], call: call)
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            self.session = s
            s.start()
        }
    }

    /// 保存してある鍵で、新しい接続情報をもらう（画面は出ない）
    @objc func getToken(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId"), !clientId.isEmpty else {
            call.reject("ログインの設定がありません", "config")
            return
        }
        guard let refresh = KoeKeychain.read() else {
            call.reject("ログインしていません", "none")
            return
        }
        requestToken(["client_id": clientId, "refresh_token": refresh, "grant_type": "refresh_token"], call: call)
    }

    @objc func signOut(_ call: CAPPluginCall) {
        let refresh = KoeKeychain.read()
        KoeKeychain.delete()
        guard let refresh else { call.resolve(); return }
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/revoke")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = formBody(["token": refresh])
        URLSession.shared.dataTask(with: req) { _, _, _ in call.resolve() }.resume()
    }

    private func formBody(_ params: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return params.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        }.joined(separator: "&").data(using: .utf8) ?? Data()
    }

    private func requestToken(_ params: [String: String], call: CAPPluginCall) {
        var req = URLRequest(url: tokenURL)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = formBody(params)
        URLSession.shared.dataTask(with: req) { data, _, error in
            if error != nil {
                call.reject("通信できませんでした", "network")
                return
            }
            let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
            guard let access = json["access_token"] as? String else {
                // 鍵が無効になったときだけ消す。一時的なエラーでは消さない
                if json["error"] as? String == "invalid_grant" {
                    KoeKeychain.delete()
                    call.reject("もう一度ログインしてください", "revoked")
                } else {
                    call.reject("ログインできませんでした", "failed")
                }
                return
            }
            if let refresh = json["refresh_token"] as? String { KoeKeychain.save(refresh) }
            call.resolve([
                "access_token": access,
                "expires_in": json["expires_in"] as? Int ?? 3600,
                "scope": json["scope"] as? String ?? params["scope"] ?? "",
            ])
        }.resume()
    }
}

// MARK: - 声の聞き取り

@objc(KoeSpeechPlugin)
public class KoeSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KoeSpeechPlugin"
    public let jsName = "KoeSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise),
    ]

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var tapInstalled = false
    private var running = false

    @objc func start(_ call: CAPPluginCall) {
        let lang = call.getString("lang") ?? "ja-JP"
        let hints = call.getArray("hints", String.self) ?? []
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.reject("音声認識が許可されていません", "not-allowed")
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("マイクが許可されていません", "not-allowed")
                        return
                    }
                    self.begin(lang: lang, hints: hints, call: call)
                }
            }
        }
    }

    private func begin(lang: String, hints: [String], call: CAPPluginCall) {
        finish(cancel: true)
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: lang)), rec.isAvailable else {
            call.reject("音声認識につながりませんでした", "network")
            return
        }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("マイクが使えません", "audio-capture")
            return
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            call.reject("マイクが見つかりません", "audio-capture")
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        req.contextualStrings = Array(hints.prefix(100))
        if #available(iOS 16, *) { req.addsPunctuation = false }

        recognizer = rec
        request = req
        running = true
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
        tapInstalled = true
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.running else { return }
                if let result {
                    self.notifyListeners("result", data: [
                        "text": result.bestTranscription.formattedString,
                        "isFinal": result.isFinal,
                    ])
                    if result.isFinal { self.end(error: nil); return }
                }
                if let error { self.end(error: self.errorCode(error)) }
            }
        }
        engine.prepare()
        do {
            try engine.start()
            call.resolve()
        } catch {
            finish(cancel: true)
            call.reject("マイクが使えません", "audio-capture")
        }
    }

    private func errorCode(_ error: Error) -> String {
        let e = error as NSError
        // 1110：何も聞こえなかった
        if e.domain == "kAFAssistantErrorDomain", e.code == 1110 { return "no-speech" }
        if e.domain == NSURLErrorDomain { return "network" }
        return "no-speech"
    }

    private func end(error: String?) {
        guard running else { return }
        finish(cancel: false)
        notifyListeners("end", data: error.map { ["error": $0] } ?? [:])
    }

    private func finish(cancel: Bool) {
        running = false
        if engine.isRunning { engine.stop() }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio()
        if cancel { task?.cancel() }
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 話し終わり。ここまでの結果を確定して終わる
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.running else { call.resolve(); return }
            if self.engine.isRunning { self.engine.stop() }
            if self.tapInstalled { self.engine.inputNode.removeTap(onBus: 0); self.tapInstalled = false }
            self.request?.endAudio()
            call.resolve()
            // 確定の結果が届かないときも、聞き取りを終わらせる
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.end(error: nil) }
        }
    }

    @objc func abort(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finish(cancel: true)
            call.resolve()
        }
    }
}
