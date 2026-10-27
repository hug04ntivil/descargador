; Instalador de Descargador. Compilar con: npm run installer
#define AppName "Descargador"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExe "Descargador.exe"

[Setup]
AppId={{B7C1F0A2-5D3E-4C8B-9A61-2F4E7D90A1C3}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Hugo
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Instalación por usuario: no pide permisos de administrador y permite que yt-dlp se actualice solo.
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=Descargador-Setup-{#AppVersion}
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"

[Files]
Source: "..\out\Descargador-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Abrir {#AppName}"; Flags: nowait postinstall skipifsilent
