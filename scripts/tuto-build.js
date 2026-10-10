#!/usr/bin/env node
'use strict';
// Faux build des tutos : imite la sortie de UnrealBuildTool sans rien compiler ni ecrire.
//   node scripts/tuto-build.js ok 10     -> 10 s, "Result: Succeeded", code 0
//   node scripts/tuto-build.js fail 8    -> 8 s, une erreur de compilation inventee, code 1
// Sortie en ASCII : la console PowerShell des agents ne lit pas l'UTF-8.

const how = process.argv[2] === 'fail' ? 'fail' : 'ok';
const seconds = Math.min(60, Math.max(1, Number(process.argv[3]) || 10));
const steps = ['Building TutoEditor and ShaderCompileWorker...', 'Using bundled DotNet SDK', 'Determining max actions to execute in parallel',
  '[1/4] Compile [x64] Module.Tuto.cpp', '[2/4] Compile [x64] Tuto.init.gen.cpp', '[3/4] Link [x64] UnrealEditor-Tuto.dll'];

console.log('[tuto] faux build : rien n\'est compile, aucun fichier n\'est ecrit.');
let i = 0;
const timer = setInterval(() => {
  if (i < steps.length) console.log(steps[i++]);
}, (seconds * 1000) / (steps.length + 1));

setTimeout(() => {
  clearInterval(timer);
  if (how === 'fail') {
    console.log('Tuto.cpp(42): error C2065: \'PorteTuto\': undeclared identifier (erreur inventee par le tuto)');
    console.log('Result: Failed (OtherCompilationError)');
    process.exit(1);
  }
  console.log('Result: Succeeded');
  process.exit(0);
}, seconds * 1000);
