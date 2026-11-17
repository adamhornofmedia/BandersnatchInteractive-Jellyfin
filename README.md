# Bandersnatch Interactive for Jellyfin

Watch **Black Mirror: Bandersnatch** interactively on your own Jellyfin server, with the
choices shown right inside the normal Jellyfin player (web browser, Jellyfin iOS/Android app).

This version is a rework of the Jellyfin plugin for **Jellyfin 12.4 / .NET 10**:

- **Choices inside the native Jellyfin web player.** The plugin injects a small script into
  jellyfin-web (via the [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
  plugin). When the playing video is the 5:12:14 Bandersnatch file, choice buttons appear over the
  player and the script jumps between scenes. Nothing changes for any other video.
- **Complete, original choice data.** Uses the full Netflix branching data (~250 scenes, all choices,
  the phone code, all endings) instead of the simplified 5-choice list of the previous plugin,
  which had wrong labels and swapped choices.
- **Touch friendly.** Works with taps on iPhone/iPad (Jellyfin iOS app) and with the mouse in a browser.
- **Story status.** Move the mouse / tap to see minutes watched in this run, number of choices made,
  and endings found so far (the Jellyfin progress bar is meaningless for this film).
- **Standalone page** with the full original player is still available at
  `/InteractiveVideo/Player/{ItemId}` (16 subtitle languages).

## Limitations

- Works only where jellyfin-web plays the video in an HTML `<video>` element:
  browsers, Jellyfin iOS app, Jellyfin Android (mobile) app with the web player.
- **Not** in the native Android TV app, Swiftfin, or Jellyfin Media Player / Jellyfin Desktop
  (they play video natively, there is nothing to hook into). There it plays as a normal 5-hour video.
- Choices and progress are stored per device (browser localStorage).

## Requirements

- Jellyfin 12.4 (built against the server's own `MediaBrowser.*.dll`, .NET 10)
- [File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) plugin
- The Bandersnatch video with duration **5:12:14**, e.g. `Black.Mirror.Bandersnatch.2018.720p.WEB-DL.x264.DUAL.mkv`

### Prepare the video

Browsers must be able to direct-play the file. Remux it to MP4 with an AAC audio track
(no re-encode, the timing stays exact):

```bash
ffmpeg -i Black.Mirror.Bandersnatch.2018.720p.WEB-DL.x264.DUAL.mkv \
  -map 0:v:0 -map 0:a:1 -c copy -movflags +faststart "Black Mirror Bandersnatch (2018).mp4"
```

(`0:a:1` is the English AAC track in that release, the first track is Portuguese E-AC3.)
Add the MP4 to a movie library.

## Build

```bash
cd jellyfin-plugin
dotnet build -c Release -o out -p:JellyfinDir="C:\Program Files\Jellyfin\Server"
```

`JellyfinDir` must point to the folder with your server's `MediaBrowser.Common.dll`,
`MediaBrowser.Controller.dll` and `MediaBrowser.Model.dll`.

## Install

1. Stop Jellyfin.
2. Copy the contents of `jellyfin-plugin/out` to
   `<Jellyfin data>/plugins/Interactive Video Player_1.2.0.0/`
   (Windows: `C:\ProgramData\Jellyfin\Server\plugins\...`).
3. **Make sure the Jellyfin service account can write to that folder**, otherwise Jellyfin fails
   to start. On Windows with the default service:
   ```powershell
   icacls "C:\ProgramData\Jellyfin\Server\plugins\Interactive Video Player_1.2.0.0" /grant "*S-1-5-20:(OI)(CI)F" /T
   ```
4. Start Jellyfin, then reload the web client (Ctrl+F5) or restart the app.

Just play the film from your library. The choices appear on their own.

## Credits

- [joric](https://github.com/joric/bandersnatch): original interactive player and branching logic
- [CyberShadow](https://github.com/CyberShadow): many fixes and improvements
- [mehotkhan](https://github.com/mehotkhan/BandersnatchInteractive): web page, subtitles
- [deathrjj](https://github.com/deathrjj/BandersnatchInteractive-Jellyfin): first Jellyfin plugin
- [adamhornofmedia](https://github.com/adamhornofmedia): Jellyfin 12.4 port, in-player choices for jellyfin-web, full choice data, touch support, story status

## License

Public domain under the [Unlicense](LICENSE), same as the original project.
