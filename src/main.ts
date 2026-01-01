import * as monaco from 'monaco-editor';
import { JSInterpreter } from './interpreter';

// Initial content
const initialHTML = `
<div class="slider-container" style="max-width: 500px; margin: auto; overflow: hidden; position: relative;">
  <div class="img-wrap" style="display: flex; transition: transform 0.5s ease-in-out;">
    <img class="img" src="https://picsum.photos/id/10/500/300" style="width: 100%; flex-shrink: 0;">
    <img class="img" src="https://picsum.photos/id/20/500/300" style="width: 100%; flex-shrink: 0;">
    <img class="img" src="https://picsum.photos/id/30/500/300" style="width: 100%; flex-shrink: 0;">
  </div>
  
  <div style="position: absolute; bottom: 20px; width: 100%; display: flex; justify-content: center; gap: 20px;">
    <button class="prev" style="padding: 10px; cursor: pointer;">Prev</button>
    <button class="next" style="padding: 10px; cursor: pointer;">Next</button>
  </div>
</div>
`;

const initialJS = `
const prev = document.querySelector('.prev');
const next = document.querySelector('.next');
const wrap = document.querySelector('.img-wrap');
const imgs = document.querySelectorAll('.img-wrap img');

let idx = 0;

function showImg() {
    if (idx >= imgs.length) {
       idx = 0;
    }
    if (idx < 0) {
       idx = imgs.length - 1;
    }
    wrap.style.transform = "translateX(-" + (idx * 100) + "%)";
}

next.addEventListener('click', function() {
    idx++;
    showImg();
});

prev.addEventListener('click', function() {
    idx--;
    showImg();
});
`;

// Models
const htmlModel = monaco.editor.createModel(initialHTML.trim(), 'html');
const jsModel = monaco.editor.createModel(initialJS.trim(), 'javascript');

// Initialize Monaco Editor
const editorContainer = document.getElementById('editor-container')!;
const editor = monaco.editor.create(editorContainer, {
  model: jsModel,
  theme: 'vs-dark',
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  lineNumbers: 'on',
  glyphMargin: true,
  scrollBeyondLastLine: false,
});

const previewIframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
const tabHtml = document.getElementById('tab-html')!;
const tabJs = document.getElementById('tab-js')!;

function updatePreview() {
  const html = htmlModel.getValue();
  const blob = new Blob([html], { type: 'text/html' });
  previewIframe.src = URL.createObjectURL(blob);
}

// Tabs switching
tabHtml.addEventListener('click', () => {
  tabHtml.classList.add('active');
  tabJs.classList.remove('active');
  editor.setModel(htmlModel);
});

tabJs.addEventListener('click', () => {
  tabJs.classList.add('active');
  tabHtml.classList.remove('active');
  editor.setModel(jsModel);
});

// Sync preview on HTML change
htmlModel.onDidChangeContent(() => {
  updatePreview();
});

// Initial Preview
updatePreview();

let interpreter: JSInterpreter | null = null;
let decorationIds: string[] = [];

const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
const stepBtn = document.getElementById('step-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const inspector = document.getElementById('inspector-content')!;
const terminal = document.getElementById('terminal-content')!;
const explanationText = document.getElementById('explanation-text')!;

function updateUI() {
  if (!interpreter) return;
  const state = interpreter.getState();

  // Update Explanation
  explanationText.innerHTML = state.lastExplanation || "Executing...";

  // Highlight Current Line
  if (editor.getModel() === jsModel) {
    decorationIds = editor.deltaDecorations(decorationIds, [
      {
        range: new monaco.Range(state.currentLine, 1, state.currentLine, 1),
        options: {
          isWholeLine: true,
          className: 'execution-line',
          glyphMarginClassName: 'execution-glyph'
        }
      }
    ]);
  }

  // Update Inspector and Stack
  const stack = state.stack;
  inspector.innerHTML = `
    <div class="stack-section">
      <h3 class="scope-title">Call Stack</h3>
      <div class="stack-list">
        ${stack.map((frame, index) => `
          <div class="stack-frame ${index === stack.length - 1 ? 'active' : ''}">
            <span class="frame-name">${frame.functionName || '(anonymous)'}</span>
            <span class="frame-index">#${index}</span>
          </div>
        `).reverse().join('')}
      </div>
    </div>
    
    <div class="scopes-section">
      <h3 class="scope-title">Variables</h3>
      ${stack.map((frame, index) => `
        <div class="scope-item">
          <div class="scope-header">Scope: ${frame.functionName || 'Global'}</div>
          ${Object.entries(frame.scope).map(([key, val]) => {
    const meta = frame.metadata[key];
    const kindStr = meta ? `<span style="color: #6366f1; font-size: 0.7rem; margin-right: 5px;">${meta.kind}</span>` : '';
    const labelStr = meta?.label ? `<span style="color: #94a3b8; font-size: 0.7rem;">(${meta.label})</span>` : '';

    return `
              <div class="var-item">
                <div class="var-name">
                  ${kindStr}
                  ${key}
                  ${labelStr}
                </div>
                <div class="var-value">${typeof val === 'object' && val !== null ? '{...}' : JSON.stringify(val)}</div>
              </div>
            `;
  }).join('')}
        </div>
      `).reverse().join('')}
    </div>
  `;

  // Update Console and scroll to bottom
  terminal.innerHTML = state.logs.map(log => `
    <div class="log-entry">
      <span class="log-prefix">></span>
      <span>${log}</span>
    </div>
  `).join('');
  terminal.scrollTop = terminal.scrollHeight;

  if (state.error) {
    terminal.innerHTML += `
      <div class="log-entry log-error">
        <span class="log-prefix">!</span>
        <span>${state.error}</span>
      </div>
    `;
    terminal.scrollTop = terminal.scrollHeight;
  }

  if (state.isFinished) {
    stepBtn.disabled = true;
    runBtn.disabled = false;
  }
}

runBtn.addEventListener('click', () => {
  const code = jsModel.getValue();
  try {
    interpreter = new JSInterpreter(code, previewIframe);
    interpreter.setOnStep(() => updateUI());
    runBtn.disabled = true;
    stepBtn.disabled = false;
    tabJs.click();
    updateUI();
  } catch (e: any) {
    alert(e.message);
  }
});

stepBtn.addEventListener('click', () => {
  if (interpreter) {
    interpreter.step();
    updateUI();
  }
});

resetBtn.addEventListener('click', () => {
  interpreter = null;
  decorationIds = editor.deltaDecorations(decorationIds, []);
  inspector.innerHTML = '<div class="empty-state">Load code to see variables</div>';
  terminal.innerHTML = '';
  explanationText.innerHTML = "Step through the code to see explanations.";
  runBtn.disabled = false;
  stepBtn.disabled = true;
  updatePreview();
});
