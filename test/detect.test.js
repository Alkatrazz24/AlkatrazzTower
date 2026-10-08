'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../lib/detect');

const yes = {
  build: [
    String.raw`& "C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" ConquerTheBackroomsEditor Win64 Development -project="C:\x\CTB.uproject" -waitmutex *>&1 | Select-Object -Last 15`,
    'cd "/c/Users/x/CTB 5.8" && MSYS_NO_PATHCONV=1 "C:/Program Files/Epic Games/UE_5.8/Engine/Build/BatchFiles/Build.bat" CTB Win64 Development -project="C:/x/CTB.uproject" -waitmutex 2>&1 | tail -40',
    String.raw`& "C:\Users\x\CTB 5.8\tools\cycle_editeur.ps1" -Cible Jeu 2>&1 | Select-Object -Last 6`,
    String.raw`Get-Process | Where-Object { $_.ProcessName -match 'UnrealEditor' } | Format-Table | Out-String; & "C:\UE\Engine\Build\BatchFiles\Build.bat" CTB Win64 Development -waitmutex`,
  ],
  test: [
    '& $Cmd (Join-Path $Projet "CTB.uproject") "-ExecCmds=Automation RunTests CTB.Reglages; Quit" -unattended -nullrhi',
    String.raw`tools\tests.ps1 -Filtre CTB.Munitions`,
    String.raw`.\tools\tests.ps1`,
  ],
  package: [
    String.raw`$a = @('BuildCookRun', '-project=x'); & "C:\UE\Engine\Build\BatchFiles\RunUAT.bat" @a`,
  ],
  commandlet: [
    String.raw`$log = "x.log"; & "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "C:\x\CTB.uproject" -run=pythonscript -script="a.py"`,
  ],
};

const no = [
  String.raw`grep -n "Lampe\|warning\|error" "/c/Users/x/AppData/Local/UnrealBuildTool/Log.txt" | tail -30`,
  String.raw`Get-Process UnrealEditor*, UnrealEditor-Cmd* -ErrorAction SilentlyContinue | Select-Object Name; Get-Content "C:\x\tools\tests.ps1" -TotalCount 60`,
  'tasklist //FI "IMAGENAME eq UnrealEditor.exe" | tail -1',
  String.raw`Start-Process "C:\UE\Engine\Binaries\Win64\UnrealEditor.exe" -ArgumentList "x.uproject"`,
  'git status',
  '"C:/Program Files/nodejs/node.exe" "C:/Tower/bin/tower-run.js" --shell bash --kind build --b64 QnVpbGQuYmF0',
  'cat Build.bat',
];

for (const [kind, cmds] of Object.entries(yes)) {
  for (const c of cmds) test(`verrouille (${kind}) : ${c.slice(0, 60)}`, () => {
    const r = classify(c);
    assert.ok(r, 'devrait etre reconnu');
    assert.strictEqual(r.kind, kind);
  });
}
for (const c of no) test(`laisse passer : ${c.slice(0, 60)}`, () => assert.strictEqual(classify(c), null));
