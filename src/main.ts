import * as monaco from 'monaco-editor';
import { JSInterpreter } from './interpreter';

// Initial content
const initialHTML = `
<div id="root" style="font-family: sans-serif; padding: 20px; text-align: center;">
  <h2 style="color: #6366f1;">Score Tracker</h2>
  <p style="font-size: 24px; font-weight: bold;">Score: <span id="scoreValue">0</span></p>
  <button id="scoreButton" style="padding: 10px 20px; font-size: 16px; background: #6366f1; color: white; border: none; border-radius: 5px; cursor: pointer;">
    Add Points
  </button>
</div>
`;

const initialJS = `
// Grab elements
const scoreParagraph = document.getElementById('scoreValue');
const myButton = document.getElementById('scoreButton');

let currentScore = 0;

myButton.addEventListener('click', function() {
    // 1. Ask for input
    let userInput = prompt("Enter points to add or subtract:");
    
    // 2. Convert and validate
    let pointsAdded = parseFloat(userInput);
    
    if (userInput === null) {
        return; 
    }
    
    if (!isNaN(pointsAdded)) {
        currentScore += pointsAdded;
        scoreParagraph.textContent = currentScore;
        console.log("New local score: " + currentScore);
    } else {
        alert("Oops! That wasn't a valid number.");
    }
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

function updateUI() {
  if (!interpreter) return;
  const state = interpreter.getState();

  // Highlight Current Line (only in JS model)
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
          ${Object.entries(frame.scope).map(([key, val]) => `
            <div class="var-item">
              <span class="var-name">${key}</span>
              <span class="var-value">${JSON.stringify(val)}</span>
            </div>
          `).join('')}
        </div>
      `).reverse().join('')}
    </div>
  `;

  // Update Console
  terminal.innerHTML = state.logs.map(log => `
    <div class="log-entry">
      <span class="log-prefix">></span>
      <span>${log}</span>
    </div>
  `).join('');

  if (state.error) {
    terminal.innerHTML += `
      <div class="log-entry log-error">
        <span class="log-prefix">!</span>
        <span>${state.error}</span>
      </div>
    `;
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
    // Listen for internal steps to update UI during event callbacks
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
  runBtn.disabled = false;
  stepBtn.disabled = true;
  updatePreview();
});
