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
