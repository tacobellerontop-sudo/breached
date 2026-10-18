; Breached's Windows installer (Inno Setup 6).
;
;   iscc /DAppVersion=0.1.0 /DAppDir=..\out\breached /DOutDir=..\release installer\breached.iss
;
; Installs the packaged app (scripts/build/package-shell.ps1 -MozillaEngine)
; to Program Files, or the user's own folder when not run as admin.
; breached.exe starts firefox.exe with the shell, which keeps the profile in
; %APPDATA%\Breached, so the install folder stays read-only.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef AppDir
  #define AppDir "..\out\breached"
#endif
#ifndef OutDir
  #define OutDir "..\release"
#endif

[Setup]
AppId={{7B1E5C2A-4F3D-4E8B-9B0A-B2EAC4ED0001}
AppName=Breached
AppVersion={#AppVersion}
AppVerName=Breached {#AppVersion}
AppPublisher=Breached
AppPublisherURL=https://github.com/tacobellerontop-sudo/breached
AppSupportURL=https://github.com/tacobellerontop-sudo/breached/issues
DefaultDirName={autopf}\Breached
DefaultGroupName=Breached
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutDir}
OutputBaseFilename=BreachedSetup-{#AppVersion}
SetupIconFile=..\branding\breached.ico
UninstallDisplayIcon={app}\breached.exe
UninstallDisplayName=Breached
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
; Tell Windows the file types changed (Open with, Default apps).
ChangesAssociations=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
; The portable start script and profile folder aren't part of an install.
Source: "{#AppDir}\*"; DestDir: "{app}"; Excludes: "Breached.bat,profile"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Clear out everything an older Breached left in its folder (0.1.7 and older
; ran our own engine build, with different files), so only this version's
; files remain. Only done when the folder holds a Breached install. The
; profile in %APPDATA%\Breached isn't touched.
Type: filesandordirs; Name: "{app}\*"; Check: IsBreachedFolder

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Registry]
; Breached as an app Windows knows: listed under "Open with" and in Settings >
; Apps > Default apps for web pages, PDFs and pictures, and for http(s) links.
; Everything is under the user's own (or, for all users, the machine's)
; Software key, and goes when Breached is uninstalled.
Root: HKA; Subkey: "Software\Classes\BreachedHTML"; ValueType: string; ValueName: ""; ValueData: "Breached HTML Document"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\BreachedHTML\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\breached.exe,0"
Root: HKA; Subkey: "Software\Classes\BreachedHTML\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\breached.exe"" ""%1"""
Root: HKA; Subkey: "Software\Classes\BreachedPDF"; ValueType: string; ValueName: ""; ValueData: "Breached PDF Document"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\BreachedPDF\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\breached.exe,0"
Root: HKA; Subkey: "Software\Classes\BreachedPDF\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\breached.exe"" ""%1"""
Root: HKA; Subkey: "Software\Classes\BreachedFile"; ValueType: string; ValueName: ""; ValueData: "Breached Document"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\BreachedFile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\breached.exe,0"
Root: HKA; Subkey: "Software\Classes\BreachedFile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\breached.exe"" ""%1"""
Root: HKA; Subkey: "Software\Classes\BreachedURL"; ValueType: string; ValueName: ""; ValueData: "Breached URL"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\BreachedURL"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\BreachedURL\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\breached.exe,0"
Root: HKA; Subkey: "Software\Classes\BreachedURL\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\breached.exe"" ""%1"""
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached"; ValueType: string; ValueName: ""; ValueData: "Breached"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\breached.exe,0"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\breached.exe"""
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Breached"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: "{app}\breached.exe,0"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "A light, keyboard-driven web browser"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\StartMenu"; ValueType: string; ValueName: "StartMenuInternet"; ValueData: "Breached"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\URLAssociations"; ValueType: string; ValueName: "http"; ValueData: "BreachedURL"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\URLAssociations"; ValueType: string; ValueName: "https"; ValueData: "BreachedURL"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".htm"; ValueData: "BreachedHTML"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".html"; ValueData: "BreachedHTML"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".shtml"; ValueData: "BreachedHTML"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xht"; ValueData: "BreachedHTML"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xhtml"; ValueData: "BreachedHTML"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pdf"; ValueData: "BreachedPDF"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".svg"; ValueData: "BreachedFile"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".webp"; ValueData: "BreachedFile"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".avif"; ValueData: "BreachedFile"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".txt"; ValueData: "BreachedFile"
Root: HKA; Subkey: "Software\Clients\StartMenuInternet\Breached\Capabilities\FileAssociations"; ValueType: string; ValueName: ".json"; ValueData: "BreachedFile"
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Breached"; ValueData: "Software\Clients\StartMenuInternet\Breached\Capabilities"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.htm\OpenWithProgids"; ValueType: string; ValueName: "BreachedHTML"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.html\OpenWithProgids"; ValueType: string; ValueName: "BreachedHTML"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.shtml\OpenWithProgids"; ValueType: string; ValueName: "BreachedHTML"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.xht\OpenWithProgids"; ValueType: string; ValueName: "BreachedHTML"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.xhtml\OpenWithProgids"; ValueType: string; ValueName: "BreachedHTML"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: string; ValueName: "BreachedPDF"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.svg\OpenWithProgids"; ValueType: string; ValueName: "BreachedFile"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.webp\OpenWithProgids"; ValueType: string; ValueName: "BreachedFile"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.avif\OpenWithProgids"; ValueType: string; ValueName: "BreachedFile"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: string; ValueName: "BreachedFile"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.json\OpenWithProgids"; ValueType: string; ValueName: "BreachedFile"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Breached"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\breached.exe"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".htm"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".html"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".shtml"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".xht"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".xhtml"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".pdf"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".svg"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".webp"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".avif"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".txt"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\breached.exe\SupportedTypes"; ValueType: string; ValueName: ".json"; ValueData: ""

[Icons]
Name: "{autoprograms}\Breached"; Filename: "{app}\breached.exe"
Name: "{autodesktop}\Breached"; Filename: "{app}\breached.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\breached.exe"; Description: "Start Breached"; Flags: nowait postinstall skipifsilent
; Updates from settings run this installer with /SILENT /update=1 after
; Breached has quit; start it again when the files are in place.
Filename: "{app}\breached.exe"; Flags: nowait; Check: IsUpdate

[Code]
function IsBreachedFolder: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\breached\application.ini'));
end;

function IsUpdate: Boolean;
begin
  Result := ExpandConstant('{param:update|0}') = '1';
end;
