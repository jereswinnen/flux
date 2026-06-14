import SwiftUI
import FluxAPI

struct AddContentView: View {
    let onAdded: () -> Void

    @Environment(AppConfig.self) private var config
    @Environment(\.dismiss) private var dismiss
    @State private var model: AddContentModel?

    var body: some View {
        NavigationStack {
            Group {
                if let model { content(model) } else { ProgressView() }
            }
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .navigationDestination(for: PodcastShow.self) { show in
                PodcastEpisodesView(show: show, onAdded: onAdded)
            }
        }
        .task { if model == nil { model = AddContentModel(config: config) } }
    }

    @ViewBuilder private func content(_ model: AddContentModel) -> some View {
        @Bindable var model = model
        Form {
            Picker("Type", selection: $model.mode) {
                Text("Link").tag(AddContentModel.Mode.link)
                Text("Podcast").tag(AddContentModel.Mode.podcast)
            }
            .pickerStyle(.segmented)

            if model.mode == .link {
                Section("Article or YouTube URL") {
                    TextField("https://…", text: $model.urlText)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    Button {
                        Task { if await model.addLink() { onAdded(); dismiss() } }
                    } label: {
                        if model.inFlight { ProgressView() } else { Text("Add") }
                    }
                    .disabled(model.urlText.trimmingCharacters(in: .whitespaces).isEmpty || model.inFlight)
                }
            } else {
                Section {
                    TextField("Search podcasts", text: $model.podcastQuery)
                        .autocorrectionDisabled()
                        .onSubmit { Task { await model.searchPodcasts() } }
                }
                Section {
                    ForEach(model.shows, id: \.collectionId) { show in
                        NavigationLink(value: show) {
                            HStack(spacing: 10) {
                                Artwork(url: show.artworkUrl, size: 40, cornerRadius: 6)
                                VStack(alignment: .leading) {
                                    Text(show.name).font(.callout).lineLimit(1)
                                    Text(show.artistName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                }
            }

            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
    }
}
