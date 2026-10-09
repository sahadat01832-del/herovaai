// Unit test for extractArtifacts — the three failure modes from 2026-10-08.
const extractArtifacts = require('../src/routes/chat').extractArtifacts;

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log(`  ✗ ${name}`)); };

// 1. The REAL broken Flappy Bird response from MongoDB: placeholder skeleton
//    inside a closed fence → must produce NO artifact (no fake Run button).
const realBroken = `Here's a thinking process:\n\n1. Analyze...\n\nLet's draft:\n\n\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Flappy Bird Clone</title>
    <style>
        /* center canvas, nice background, start/gameover screens */
    </style>
</head>
<body>
    <canvas id="gameCanvas" width="320" height="512"></canvas>
    <script>
        // All JS here
    </script>
</body>
</html>
\`\`\`\n\n- Score tracking ✓\n- Start`;
const brokenArts = extractArtifacts(realBroken, 'game');
check('real broken flappy → 0 artifacts', brokenArts.length === 0);

// 2. A complete real game → extracted as a runnable artifact.
const realGame = 'Sure!\n\n```html\n<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><canvas id="c"></canvas><script>\nconst cv=document.getElementById("c");const ctx=cv.getContext("2d");let y=100;function loop(){ctx.clearRect(0,0,320,512);ctx.fillStyle="yellow";ctx.fillRect(60,y,34,24;y+=2;requestAnimationFrame(loop)}loop();\n</script></body></html>\n```';
const goodArts = extractArtifacts(realGame, 'game');
check('complete game → 1 artifact', goodArts.length === 1);
check('complete game keeps code', goodArts[0]?.code.includes('requestAnimationFrame'));
check('complete game typed as game', goodArts[0]?.type === 'game');

// 3. Unclosed fence (model forgot ``` or hit the token cap) → salvaged.
const unclosed = 'Building it now:\n\n```html\n<!DOCTYPE html><html><body><div id="app">hi</div><script>\nconst el=document.getElementById("app");el.textContent="it works";setInterval(()=>{},1000);\n</script></body></html>';
const salvaged = extractArtifacts(unclosed, 'game');
check('unclosed fence → salvaged', salvaged.length === 1);
check('salvaged keeps code', salvaged[0]?.code.includes('it works'));

// 4. Sketch-then-real-code: sketch filtered, real block kept.
const mixed = '```html\n<html><script>\n// All JS here\n</script></html>\n```\nand the real one:\n\n```html\n<html><body><script>\nvar score=0;function tick(){score++;requestAnimationFrame(tick)}tick();\n</script></body></html>\n```';
const mixedArts = extractArtifacts(mixed, 'game');
check('mixed → only the real block', mixedArts.length === 1 && mixedArts[0].code.includes('tick'));

// 5. Normal prose (no fences) → nothing.
check('no fences → 0 artifacts', extractArtifacts('Just a normal chat reply, no code here.', 'general').length === 0);

// 6. External-script-only page (Tailwind CDN, no inline JS) must NOT be rejected.
const externalOnly = '```html\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4">Static but legit</div></body></html>\n```';
check('external-script page kept', extractArtifacts(externalOnly, 'webapp').length === 1);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
