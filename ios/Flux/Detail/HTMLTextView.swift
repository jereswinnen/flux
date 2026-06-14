import SwiftUI
import UIKit

/// Displays a pre-built attributed string in a selectable, non-editable UITextView sized to
/// its content. Highlights are anchored by character range (with a first-text-match fallback);
/// selecting text offers a custom "Highlight" action that reports the exact selected range.
struct HTMLTextView: UIViewRepresentable {
    let attributed: NSAttributedString
    /// Highlights to mark: id + text + optional stored char offsets (charStart/charEnd).
    var highlights: [(id: String, text: String, charStart: Int?, charEnd: Int?)] = []
    var onTapHighlight: ((String) -> Void)? = nil
    /// Reports the selected substring and its exact range when the user taps "Highlight".
    var onCreateHighlight: ((_ text: String, _ range: NSRange) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.isEditable = false
        tv.isSelectable = true
        tv.isScrollEnabled = false
        tv.backgroundColor = .clear
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        tv.textContainer.widthTracksTextView = true
        tv.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tv.setContentHuggingPriority(.required, for: .vertical)
        tv.delegate = context.coordinator
        context.coordinator.textView = tv

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        tv.addGestureRecognizer(tap)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        let mutable = NSMutableAttributedString(attributedString: attributed)
        context.coordinator.applyHighlights(into: mutable)
        tv.attributedText = mutable
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? uiView.bounds.width
        guard width > 0 else { return nil }
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(fitted.height))
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: HTMLTextView
        weak var textView: UITextView?

        init(_ parent: HTMLTextView) { self.parent = parent }

        func applyHighlights(into text: NSMutableAttributedString) {
            let ns = text.string as NSString
            for hl in parent.highlights {
                guard let range = resolveRange(for: hl, in: ns) else { continue }
                text.addAttribute(.backgroundColor, value: UIColor.systemYellow.withAlphaComponent(0.35), range: range)
                text.addAttribute(.init("hlid"), value: hl.id, range: range)
            }
        }

        /// Prefer the stored char offsets (exact, disambiguates repeated phrases); fall back
        /// to the first text match if the offsets are absent or no longer line up.
        private func resolveRange(for hl: (id: String, text: String, charStart: Int?, charEnd: Int?), in ns: NSString) -> NSRange? {
            if let s = hl.charStart, let e = hl.charEnd, s >= 0, e > s, e <= ns.length {
                let r = NSRange(location: s, length: e - s)
                if ns.substring(with: r) == hl.text { return r }
            }
            let match = ns.range(of: hl.text)
            return match.location == NSNotFound ? nil : match
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let tv = textView, let onTap = parent.onTapHighlight else { return }
            let point = gesture.location(in: tv)
            guard let position = tv.closestPosition(to: point),
                  let range = tv.tokenizer.rangeEnclosingPosition(position, with: .character, inDirection: .layout(.right)) else { return }
            let offset = tv.offset(from: tv.beginningOfDocument, to: range.start)
            guard let attributed = tv.attributedText, offset >= 0, offset < attributed.length else { return }
            if let id = attributed.attribute(.init("hlid"), at: offset, effectiveRange: nil) as? String {
                onTap(id)
            }
        }

        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard range.length > 0, let onCreate = parent.onCreateHighlight else {
                return UIMenu(children: suggestedActions)
            }
            let selected = (textView.text as NSString).substring(with: range)
            let highlight = UIAction(title: "Highlight", image: UIImage(systemName: "highlighter")) { _ in
                onCreate(selected, range)
            }
            return UIMenu(children: [highlight] + suggestedActions)
        }
    }
}
