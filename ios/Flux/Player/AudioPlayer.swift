import Foundation
import Observation
import AVFoundation
import MediaPlayer
import FluxAPI

@MainActor @Observable
final class AudioPlayer {
    private let player = AVPlayer()
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?

    var currentItemId: String?
    /// Now-playing title/artwork, captured at load() so UI (e.g. the mini-player) needn't
    /// re-fetch the Item from SwiftData.
    var currentTitle: String?
    var currentArtworkUrl: String?
    var isPlaying = false
    var currentTime: Double = 0
    var duration: Double = 0
    var rate: Float = 1.0
    var errorMessage: String?

    init() {
        configureSession()
        configureRemoteCommands()
        addTimeObserver()
    }

    func load(item: Item) {
        guard currentItemId != item.id else { return }
        guard let urlString = item.audioUrl, let url = URL(string: urlString) else {
            errorMessage = "No audio for this item."
            return
        }
        errorMessage = nil
        currentItemId = item.id
        currentTitle = item.title
        currentArtworkUrl = item.artworkUrl
        // A fresh item starts paused; replaceCurrentItem resets the AVPlayer rate to 0.
        isPlaying = false
        currentTime = 0
        let playerItem = AVPlayerItem(url: url)
        observeStatus(of: playerItem)
        player.replaceCurrentItem(with: playerItem)
        duration = item.durationSec.map(Double.init) ?? 0
        updateNowPlaying(item: item)
    }

    private func observeStatus(of playerItem: AVPlayerItem) {
        statusObservation = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let message = item.error?.localizedDescription ?? "Couldn't play this audio."
            Task { @MainActor [weak self] in
                self?.errorMessage = message
                self?.isPlaying = false
            }
        }
    }

    func togglePlayPause() { isPlaying ? pause() : play() }

    func play() {
        try? AVAudioSession.sharedInstance().setActive(true)
        player.rate = rate
        isPlaying = true
        updateNowPlayingPlayback()
    }

    func pause() {
        player.pause()
        isPlaying = false
        updateNowPlayingPlayback()
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600))
        currentTime = seconds
        updateNowPlayingPlayback()
    }

    func skip(_ delta: Double) { seek(to: currentTime + delta) }

    func setRate(_ newRate: Float) {
        rate = newRate
        if isPlaying { player.rate = newRate }
    }

    // MARK: - Private

    private func configureSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    }

    private func addTimeObserver() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            Task { @MainActor in
                if time.seconds.isFinite { self.currentTime = time.seconds }
                if let d = self.player.currentItem?.duration.seconds, d.isFinite, d > 0 {
                    self.duration = d
                }
                self.updateNowPlayingPlayback()
            }
        }
    }

    private func configureRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.play() }
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        c.skipForwardCommand.preferredIntervals = [15]
        c.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(15) }
            return .success
        }
        c.skipBackwardCommand.preferredIntervals = [15]
        c.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(-15) }
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: e.positionTime) }
            return .success
        }
    }

    private func updateNowPlaying(item: Item) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: item.title,
            MPMediaItemPropertyArtist: item.source ?? "",
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlayingPlayback() {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(rate) : 0.0
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
