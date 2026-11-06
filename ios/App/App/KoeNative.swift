// Koe：iOSの機能（切れないGoogleログイン、声の聞き取り）をWeb側の画面へ渡す部分
import AVFoundation
import AuthenticationServices
import Capacitor
import WebKit
import CryptoKit
import EventKit
import Speech
import UIKit
import UserNotifications

/// 画面の土台。Koe専用の機能をここで登録する
class KoeBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KoeAuthPlugin())
        bridge?.registerPluginInstance(KoeSpeechPlugin())
        bridge?.registerPluginInstance(KoeCalendarPlugin())
        bridge?.registerPluginInstance(KoeLocalPlugin())
        UNUserNotificationCenter.current().delegate = KoeNotifyPresenter.shared
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

// MARK: - Appleカレンダー（試作：端末のカレンダーに入っている予定を読むだけ）

@objc(KoeCalendarPlugin)
public class KoeCalendarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KoeCalendarPlugin"
    public let jsName = "KoeCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "events", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeReminder", returnType: CAPPluginReturnPromise),
    ]
    private let store = EKEventStore()

    private var allowed: Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) { return status == .fullAccess }
        return status == .authorized
    }

    private func statusName() -> String {
        if allowed { return "allowed" }
        return EKEventStore.authorizationStatus(for: .event) == .notDetermined ? "notAsked" : "denied"
    }

    /// カレンダーの利用を尋ねる。答えたあとは二度と出ないので、断られたら設定アプリの案内が要る
    @objc func request(_ call: CAPPluginCall) {
        let done: (Bool, Error?) -> Void = { [weak self] _, _ in
            guard let self else { return }
            self.store.reset()
            call.resolve(["status": self.statusName()])
        }
        if #available(iOS 17.0, *) {
            store.requestFullAccessToEvents(completion: done)
        } else {
            store.requestAccess(to: .event, completion: done)
        }
    }

    @objc func calendars(_ call: CAPPluginCall) {
        guard allowed else { call.reject("カレンダーの許可がありません", "denied"); return }
        let main = store.defaultCalendarForNewEvents?.calendarIdentifier
        call.resolve(["calendars": store.calendars(for: .event).map { c -> [String: Any] in
            ["id": c.calendarIdentifier, "name": c.title, "color": Self.hex(c.cgColor),
             "writable": c.allowsContentModifications, "source": c.source?.title ?? "",
             "isDefault": c.calendarIdentifier == main]
        }])
    }

    /// from・to は1970年からのミリ秒
    @objc func events(_ call: CAPPluginCall) {
        guard allowed else { call.reject("カレンダーの許可がありません", "denied"); return }
        guard let from = call.getDouble("from"), let to = call.getDouble("to"), from < to else {
            call.reject("期間の指定が正しくありません"); return
        }
        DispatchQueue.global(qos: .userInitiated).async { [store] in
            let predicate = store.predicateForEvents(withStart: Date(timeIntervalSince1970: from / 1000),
                                                     end: Date(timeIntervalSince1970: to / 1000), calendars: nil)
            let out = store.events(matching: predicate).map { e -> [String: Any] in
                ["id": e.eventIdentifier ?? "", "calId": e.calendar?.calendarIdentifier ?? "",
                 "title": e.title ?? "", "location": e.location ?? "", "notes": e.notes ?? "", "allDay": e.isAllDay,
                 "start": e.startDate.timeIntervalSince1970 * 1000, "end": e.endDate.timeIntervalSince1970 * 1000,
                 "recurring": e.hasRecurrenceRules, "locked": e.hasAttendees,
                 "alarms": (e.alarms ?? []).map { -$0.relativeOffset / 60 }]
            }
            call.resolve(["events": out])
        }
    }

    /// 繰り返しの予定は、その回の開始日時で探す
    private func occurrence(_ id: String, _ ms: Double) -> EKEvent? {
        let at = Date(timeIntervalSince1970: ms / 1000)
        let predicate = store.predicateForEvents(withStart: at.addingTimeInterval(-86400), end: at.addingTimeInterval(86400), calendars: nil)
        return store.events(matching: predicate).first { $0.eventIdentifier == id && abs($0.startDate.timeIntervalSince(at)) < 1 }
    }

    /// 繰り返しの規則。曜日は 0=日曜（JavaScriptと同じ）
    private func recurrenceRule(_ r: JSObject) -> EKRecurrenceRule? {
        let interval = max(r["interval"] as? Int ?? 1, 1)
        let weekday = { (n: Int) in EKWeekday(rawValue: n + 1) }
        let end: EKRecurrenceEnd? = (r["count"] as? Int).map { EKRecurrenceEnd(occurrenceCount: $0) }
            ?? (r["until"] as? Double).map { EKRecurrenceEnd(end: Date(timeIntervalSince1970: $0 / 1000)) }
        var freq = EKRecurrenceFrequency.daily
        var days: [EKRecurrenceDayOfWeek]?
        var monthDays: [NSNumber]?
        switch r["freq"] as? String {
        case "DAILY": freq = .daily
        case "WEEKDAYS":
            freq = .weekly
            days = (1...5).compactMap { weekday($0) }.map { EKRecurrenceDayOfWeek($0) }
        case "WEEKLY":
            freq = .weekly
            days = (r["days"] as? [Int] ?? []).compactMap { weekday($0) }.map { EKRecurrenceDayOfWeek($0) }
        case "MONTHLY":
            freq = .monthly
            if r["monthEnd"] as? Bool == true { monthDays = [-1] }
            if let n = r["nth"] as? Int, let w = (r["weekday"] as? Int).flatMap(weekday) { days = [EKRecurrenceDayOfWeek(w, weekNumber: n)] }
        case "YEARLY": freq = .yearly
        default: return nil
        }
        return EKRecurrenceRule(recurrenceWith: freq, interval: interval, daysOfTheWeek: days, daysOfTheMonth: monthDays,
                                monthsOfTheYear: nil, weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: nil, end: end)
    }

    /// 登録と変更。id があれば変更。scope は this / following / all
    @objc func save(_ call: CAPPluginCall) {
        guard allowed else { call.reject("カレンダーの許可がありません", "denied"); return }
        guard let startMs = call.getDouble("start"), let endMs = call.getDouble("end"), let calId = call.getString("calId"),
              let calendar = store.calendar(withIdentifier: calId), calendar.allowsContentModifications else {
            call.reject("このカレンダーには書き込めません"); return
        }
        let scope = call.getString("scope") ?? "this"
        var start = Date(timeIntervalSince1970: startMs / 1000)
        let allDay = call.getBool("allDay") ?? false
        // Koeの終日の終わりは次の日の0時。Appleは最後の日の中に置く
        let duration = (endMs - startMs) / 1000 - (allDay ? 1 : 0)
        let event: EKEvent
        if let id = call.getString("id") {
            guard let occ = call.getDouble("occurrence"), let found = occurrence(id, occ) else {
                call.reject("予定が見つかりませんでした。読み直してください"); return
            }
            if scope == "all", found.hasRecurrenceRules {
                // すべての日：最初の回を、同じだけずらす（繰り返しの開始日を動かさない）
                guard let first = store.event(withIdentifier: id) else { call.reject("予定が見つかりませんでした"); return }
                start = first.startDate.addingTimeInterval(start.timeIntervalSince(found.startDate))
                event = first
            } else {
                event = found
            }
        } else {
            event = EKEvent(eventStore: store)
            if let r = call.getObject("recur"), let rule = recurrenceRule(r) { event.addRecurrenceRule(rule) }
        }
        event.calendar = calendar
        event.title = call.getString("title") ?? ""
        let location = call.getString("location") ?? ""
        event.location = location.isEmpty ? nil : location
        if let notes = call.getString("notes") { event.notes = notes.isEmpty ? nil : notes }
        event.isAllDay = allDay
        event.startDate = start
        event.endDate = start.addingTimeInterval(duration)
        if let minutes = call.getArray("alarms") as? [Double] { event.alarms = minutes.map { EKAlarm(relativeOffset: -$0 * 60) } }
        do {
            try store.save(event, span: event.hasRecurrenceRules && scope != "this" ? .futureEvents : .thisEvent, commit: true)
            call.resolve(["id": event.eventIdentifier ?? ""])
        } catch {
            call.reject("保存できませんでした：\(error.localizedDescription)")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard allowed else { call.reject("カレンダーの許可がありません", "denied"); return }
        let scope = call.getString("scope") ?? "this"
        guard let id = call.getString("id"),
              let target = scope == "all" ? store.event(withIdentifier: id) : call.getDouble("occurrence").flatMap({ occurrence(id, $0) }) else {
            call.reject("予定が見つかりませんでした。読み直してください"); return
        }
        do {
            try store.remove(target, span: target.hasRecurrenceRules && scope != "this" ? .futureEvents : .thisEvent, commit: true)
            call.resolve()
        } catch {
            call.reject("削除できませんでした：\(error.localizedDescription)")
        }
    }

    // MARK: リマインダー（Koeのタスクとして使う）

    private var remindersAllowed: Bool {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        if #available(iOS 17.0, *) { return status == .fullAccess }
        return status == .authorized
    }

    @objc func requestReminders(_ call: CAPPluginCall) {
        let done: (Bool, Error?) -> Void = { [weak self] _, _ in
            guard let self else { return }
            call.resolve(["status": self.remindersAllowed ? "allowed" : "denied"])
        }
        if #available(iOS 17.0, *) {
            store.requestFullAccessToReminders(completion: done)
        } else {
            store.requestAccess(to: .reminder, completion: done)
        }
    }

    private static func ymd(_ c: DateComponents?) -> String? {
        guard let c, let y = c.year, let m = c.month, let d = c.day else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// リストと、まだ終わっていないリマインダー
    @objc func reminders(_ call: CAPPluginCall) {
        guard remindersAllowed else { call.reject("リマインダーの許可がありません", "denied"); return }
        let main = store.defaultCalendarForNewReminders()?.calendarIdentifier
        let lists = store.calendars(for: .reminder).map { c -> [String: Any] in
            ["id": c.calendarIdentifier, "title": c.title, "writable": c.allowsContentModifications, "isDefault": c.calendarIdentifier == main]
        }
        store.fetchReminders(matching: store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)) { items in
            let out = (items ?? []).map { r -> [String: Any] in
                var one: [String: Any] = ["id": r.calendarItemIdentifier, "listId": r.calendar?.calendarIdentifier ?? "",
                                          "title": r.title ?? "", "notes": r.notes ?? ""]
                if let due = Self.ymd(r.dueDateComponents) { one["due"] = due }
                return one
            }
            call.resolve(["lists": lists, "reminders": out])
        }
    }

    /// 登録と変更。id があれば変更。done で完了・未完了を切り替える
    @objc func saveReminder(_ call: CAPPluginCall) {
        guard remindersAllowed else { call.reject("リマインダーの許可がありません", "denied"); return }
        let item: EKReminder
        if let id = call.getString("id") {
            guard let found = store.calendarItem(withIdentifier: id) as? EKReminder else {
                call.reject("リマインダーが見つかりませんでした。読み直してください"); return
            }
            item = found
        } else {
            guard let listId = call.getString("listId"), let list = store.calendar(withIdentifier: listId), list.allowsContentModifications else {
                call.reject("このリストには書き込めません"); return
            }
            item = EKReminder(eventStore: store)
            item.calendar = list
        }
        if let title = call.getString("title") { item.title = title }
        if let notes = call.getString("notes"), !notes.isEmpty { item.notes = notes }
        if let done = call.getBool("done") { item.isCompleted = done }
        if call.getBool("noDue") == true {
            item.dueDateComponents = nil
        } else if let due = call.getString("due"), due != Self.ymd(item.dueDateComponents) {
            // 日が変わったときだけ入れ直す（時刻つきのリマインダーの時刻を消さない）
            let p = due.split(separator: "-").compactMap { Int($0) }
            if p.count == 3 { item.dueDateComponents = DateComponents(year: p[0], month: p[1], day: p[2]) }
        }
        do {
            try store.save(item, commit: true)
            call.resolve(["id": item.calendarItemIdentifier])
        } catch {
            call.reject("保存できませんでした：\(error.localizedDescription)")
        }
    }

    @objc func removeReminder(_ call: CAPPluginCall) {
        guard remindersAllowed else { call.reject("リマインダーの許可がありません", "denied"); return }
        guard let id = call.getString("id"), let item = store.calendarItem(withIdentifier: id) as? EKReminder else {
            call.reject("リマインダーが見つかりませんでした。読み直してください"); return
        }
        do {
            try store.remove(item, commit: true)
            call.resolve()
        } catch {
            call.reject("削除できませんでした：\(error.localizedDescription)")
        }
    }

    private static func hex(_ color: CGColor?) -> String {
        guard let color, let rgb = color.converted(to: CGColorSpaceCreateDeviceRGB(), intent: .defaultIntent, options: nil),
              let c = rgb.components, c.count >= 3 else { return "#2f5d8a" }
        return String(format: "#%02x%02x%02x", Int(c[0] * 255), Int(c[1] * 255), Int(c[2] * 255))
    }
}

// MARK: - Koeの中だけの保存（端末の中のファイル。端末のバックアップにも含まれる）

@objc(KoeLocalPlugin)
public class KoeLocalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KoeLocalPlugin"
    public let jsName = "KoeLocal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backups", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyRequest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifySchedule", returnType: CAPPluginReturnPromise),
    ]
    private let keepDays = 7
    private let notifyPrefix = "koe-local-"

    private func notifyLabel(_ s: UNAuthorizationStatus) -> String {
        switch s {
        case .notDetermined: return "undecided"
        case .denied: return "denied"
        default: return "allowed"
        }
    }

    @objc func notifyStatus(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            center.getPendingNotificationRequests { pending in
                call.resolve(["status": self.notifyLabel(settings.authorizationStatus),
                              "pending": pending.filter { $0.identifier.hasPrefix(self.notifyPrefix) }.count])
            }
        }
    }

    @objc func notifyRequest(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            center.getNotificationSettings { call.resolve(["status": self.notifyLabel($0.authorizationStatus)]) }
        }
    }

    // いつも全部を入れ替える。消した予定や変えた時刻の通知が残らないようにする
    @objc func notifySchedule(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        let items = call.getArray("items") ?? []
        center.getPendingNotificationRequests { pending in
            center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(self.notifyPrefix) })
            let group = DispatchGroup()
            var added = 0
            let lock = NSLock()
            for case let item as JSObject in items {
                guard let id = item["id"] as? String, let title = item["title"] as? String, let at = (item["at"] as? NSNumber)?.doubleValue else { continue }
                let wait = at / 1000 - Date().timeIntervalSince1970
                guard wait > 0 else { continue }
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = item["body"] as? String ?? ""
                content.sound = .default
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false)
                group.enter()
                center.add(UNNotificationRequest(identifier: self.notifyPrefix + id, content: content, trigger: trigger)) { err in
                    if err == nil { lock.lock(); added += 1; lock.unlock() }
                    group.leave()
                }
            }
            group.notify(queue: .main) { call.resolve(["count": added]) }
        }
    }

    private func folder() throws -> URL {
        let url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("KoeLocal", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func backupNames() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: folder().path)
            .filter { $0.hasPrefix("backup-") && $0.hasSuffix(".json") }.sorted().reversed()
    }

    /// name を渡すと、その控えを読む
    @objc func read(_ call: CAPPluginCall) {
        do {
            let name = call.getString("name") ?? "local.json"
            let known = try backupNames()
            guard name == "local.json" || known.contains(name) else { call.reject("控えが見つかりません"); return }
            let url = try folder().appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path) else { call.resolve([:]); return }
            call.resolve(["text": try String(contentsOf: url, encoding: .utf8)])
        } catch {
            call.reject("読み込めませんでした：\(error.localizedDescription)")
        }
    }

    /// 書く前に、その日の最初の内容を控えに残す（7日分）。途中で切れても壊れないよう一度に置き換える
    @objc func write(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("書き込む内容がありません"); return }
        do {
            let dir = try folder()
            let main = dir.appendingPathComponent("local.json")
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            let today = dir.appendingPathComponent("backup-\(f.string(from: Date())).json")
            if FileManager.default.fileExists(atPath: main.path), !FileManager.default.fileExists(atPath: today.path) {
                try FileManager.default.copyItem(at: main, to: today)
            }
            for old in try backupNames().dropFirst(keepDays) { try? FileManager.default.removeItem(at: dir.appendingPathComponent(old)) }
            try text.write(to: main, atomically: true, encoding: .utf8)
            call.resolve()
        } catch {
            call.reject("保存できませんでした：\(error.localizedDescription)")
        }
    }

    @objc func backups(_ call: CAPPluginCall) {
        do { call.resolve(["backups": try backupNames()]) } catch { call.reject("控えを読めませんでした") }
    }

    /// 共有の画面から、好きな場所へファイルとして渡す
    @objc func share(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let text = call.getString("text"), !name.contains("/") else { call.reject("書き出せませんでした"); return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { call.reject("書き出せませんでした"); return }
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController else { call.reject("書き出せませんでした"); return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = sheet.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: url)
                call.resolve()
            }
            vc.present(sheet, animated: true)
        }
    }
}

// Koeを開いている間に時間が来ても、通知を出す
final class KoeNotifyPresenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = KoeNotifyPresenter()
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}
