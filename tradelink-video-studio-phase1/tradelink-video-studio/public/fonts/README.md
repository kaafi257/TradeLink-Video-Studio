# Fonts (add these files before the first deployment)

The Studio self-hosts all fonts (no Google Fonts requests; the security policy blocks them).
Download each family from its official open-licence source, convert to WOFF2 if needed, and
add the licence text file beside it. Expected file names (see `src/styles/fonts.css`):

- `BricolageGrotesque-SemiBold.woff2`, `BricolageGrotesque-ExtraBold.woff2`
- `Archivo-Variable.woff2`
- `PublicSans-Regular.woff2`, `PublicSans-Medium.woff2`, `PublicSans-SemiBold.woff2`
- `NotoSansEthiopic-Variable.woff2` (Amharic) is INCLUDED, with `NotoSansEthiopic-OFL.txt` (from github.com/google/fonts, ofl/notosansethiopic)
- A `LICENSES.txt` with each family's licence (all four are published under the SIL Open Font
  License; confirm on the download page before adding).

Until the files exist the app falls back to system fonts. Amharic text will use whatever
Ethiopic-capable font the device has, so add Noto Sans Ethiopic before reviewing Amharic screens.
