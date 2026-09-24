# Installing Proteoscope

Proteoscope is one executable. The browser application and the bundled
examples are inside it, so nothing else needs to be installed.

## Release files

| Operating system | Architecture | Release file |
| --- | --- | --- |
| macOS | Apple silicon (ARM64) | `proteoscope-darwin-arm64` |
| macOS | Intel (x64) | `proteoscope-darwin-amd64` |
| Linux | x64 | `proteoscope-linux-amd64` |
| Linux | ARM64 | `proteoscope-linux-arm64` |
| Windows | x64 | `proteoscope-windows-amd64.exe` |
| Windows | ARM64 | `proteoscope-windows-arm64.exe` |

Each release also has `SHA256SUMS`, the SHA-256 checksum of every file. The
installers need it, so they install v0.6.0 and later; earlier releases can
only be downloaded by hand.

## macOS and Linux

Install the latest release as `$HOME/.local/bin/proteoscope`:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.sh | sh
```

The installer detects the operating system and CPU and downloads the matching
file and `SHA256SUMS` from the same release. It requires exactly one matching
checksum and runs the downloaded program's `--version`, and only then moves it
into place, so a failed download never replaces a working copy. It does not use
`sudo`, change `PATH` or start Proteoscope. If `$HOME/.local/bin` is not on
your `PATH`, it prints the full path to run.

To read the installer before running it:

```sh
curl --proto '=https' --tlsv1.2 -fsSLo install-proteoscope.sh \
  https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.sh
less install-proteoscope.sh
sh install-proteoscope.sh
```

To install a particular release, give its tag (the
[releases page](https://github.com/robert-mcdermott/proteoscope/releases)
lists them):

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.sh |
  PROTEOSCOPE_VERSION=v0.6.0 sh
```

To install somewhere else, use a directory you can write to:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.sh |
  PROTEOSCOPE_INSTALL_DIR="$HOME/bin" sh
```

A downloaded installer takes the same settings as options:

```sh
sh install-proteoscope.sh --version v0.6.0 --install-dir "$HOME/bin"
```

`PROTEOSCOPE_REPOSITORY=owner/repository` installs from a fork. For a
system-wide installation, download and read the script, then run it with an
administrator-owned `--install-dir`. Never pipe a download straight into
`sudo sh`.

## Windows

In PowerShell:

```powershell
irm https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.ps1 | iex
```

The program is installed as
`$env:LOCALAPPDATA\Programs\Proteoscope\proteoscope.exe`, and that folder is
added to your user `PATH`. Terminals that are already open keep their old
`PATH`, so open a new one before running `proteoscope`. The installer detects
x64 or ARM64, downloads the program and `SHA256SUMS`, requires exactly one
matching checksum, runs the downloaded program's version check, and replaces
an existing copy only after every check passes. It does not need administrator
rights. Windows cannot replace a program that is running, so stop Proteoscope
before upgrading.

### Execution policy

`irm … | iex` is not affected by the PowerShell execution policy, which
governs script *files*: this form reads the script into memory and runs it, so
it works under `Restricted`, `AllSigned` and `RemoteSigned` alike. There is no
need for `Set-ExecutionPolicy` or `Unblock-File`.

The policy does apply to a saved copy of the installer. Bypass it for that one
run instead of changing the setting:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-proteoscope.ps1
```

### Options

Piping into `iex` cannot pass parameters. Set environment variables, which the
piped form reads:

```powershell
$env:PROTEOSCOPE_VERSION = 'v0.6.0'
$env:PROTEOSCOPE_INSTALL_DIR = "$HOME\bin"
irm https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.ps1 | iex
```

or build a script block, which accepts parameters:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.ps1))) `
  -Version v0.6.0 -InstallDir "$HOME\bin"
```

| Parameter | Environment variable | Purpose |
| --- | --- | --- |
| `-Version` | `PROTEOSCOPE_VERSION` | Release tag to install. Defaults to the latest release. |
| `-InstallDir` | `PROTEOSCOPE_INSTALL_DIR` | Absolute installation folder. |
| `-Repository` | `PROTEOSCOPE_REPOSITORY` | GitHub `owner/repository`, for forks. |
| `-Architecture` | `PROTEOSCOPE_ARCH` | `amd64` or `arm64`, when detection fails. |
| `-NoPathUpdate` | `PROTEOSCOPE_NO_PATH_UPDATE` | Leave the user `PATH` unchanged. |

A parameter takes precedence over its environment variable.

### Reading the installer first

```powershell
$Installer = Join-Path $env:TEMP 'install-proteoscope.ps1'
Invoke-WebRequest -UseBasicParsing `
  'https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.ps1' `
  -OutFile $Installer
Get-Content $Installer
powershell -ExecutionPolicy Bypass -File $Installer
```

## Downloading and verifying by hand

On macOS or Linux, choose the file for your computer from the table above:

```sh
ASSET=proteoscope-linux-amd64
curl -fLO "https://github.com/robert-mcdermott/proteoscope/releases/latest/download/$ASSET"
curl -fLO https://github.com/robert-mcdermott/proteoscope/releases/latest/download/SHA256SUMS
grep "  $ASSET\$" SHA256SUMS | sha256sum --check -
chmod +x "$ASSET"
./"$ASSET" --version
```

On macOS, use `shasum -a 256 --check -` instead of `sha256sum --check -`.

In PowerShell:

```powershell
$Asset = 'proteoscope-windows-amd64.exe'
$Base = 'https://github.com/robert-mcdermott/proteoscope/releases/latest/download'
Invoke-WebRequest -UseBasicParsing "$Base/$Asset" -OutFile $Asset
Invoke-WebRequest -UseBasicParsing "$Base/SHA256SUMS" -OutFile SHA256SUMS
$Expected = (Select-String -Path SHA256SUMS -Pattern ('  ' + [regex]::Escape($Asset) + '$')).Line.Split(' ')[0]
$Actual = (Get-FileHash -Algorithm SHA256 $Asset).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) { throw 'Checksum verification failed' }
& ".\$Asset" --version
```

The checksum detects a damaged download and a file that differs from the
release's list. Both come from the same release, so it cannot protect against
someone able to replace both.

### Files downloaded in a browser

Proteoscope's programs are not signed with an Apple or Microsoft certificate.
The installers and the commands above download without a browser, so the
operating system does not flag the file. A file saved from a browser is
flagged, and the first start asks for confirmation.

**macOS.** A warning such as *Apple could not verify "proteoscope-darwin-arm64"
is free of malware* appears. Either open **System Settings → Privacy &
Security**, find the message about Proteoscope in the Security section and
click **Open Anyway**, or remove the flag in Terminal:

```sh
xattr -d com.apple.quarantine ./proteoscope-darwin-arm64
chmod +x ./proteoscope-darwin-arm64
```

If `xattr` says the attribute was not found, the file was not flagged.

**Windows.** If SmartScreen blocks the program, click **More info**, then
**Run anyway**. Or clear the flag before starting it: right-click the `.exe`,
choose **Properties**, check **Unblock** on the **General** tab and click
**OK**, or run `Unblock-File .\proteoscope-windows-amd64.exe` in PowerShell.

## Upgrading and going back

Running the installer again upgrades Proteoscope. A failed download, checksum
or version check leaves the installed copy as it was. Sessions you saved and
the download cache are not touched.

To go back to an earlier release (v0.6.0 or later), install it by tag:

```sh
PROTEOSCOPE_VERSION=v0.6.0 sh install-proteoscope.sh
```

```powershell
$env:PROTEOSCOPE_VERSION = 'v0.6.0'
irm https://raw.githubusercontent.com/robert-mcdermott/proteoscope/main/install.ps1 | iex
```

## Uninstalling

Delete the program: `~/.local/bin/proteoscope` on macOS and Linux, or the
`%LocalAppData%\Programs\Proteoscope` folder on Windows, whose entry you can
also remove from the user `PATH` (**Settings → System → About → Advanced
system settings → Environment Variables**).

Proteoscope keeps downloaded structures, maps and other public data in a cache,
which you can delete as well: `~/Library/Caches/proteoscope` on macOS,
`~/.cache/proteoscope` on Linux (or `$XDG_CACHE_HOME/proteoscope`), and
`%LocalAppData%\proteoscope` on Windows. A different `--cache-dir` puts it
elsewhere.

## Building from source

With the Go version in `go.mod` or newer:

```sh
git clone https://github.com/robert-mcdermott/proteoscope.git
cd proteoscope
go test ./...
go build -o proteoscope .
./proteoscope --version
```

The [README](../README.md#development) describes development and releases.
