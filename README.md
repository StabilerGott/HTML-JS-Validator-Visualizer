# JS Visualizer Playground

A powerful tool to help you understand JavaScript code by running it line-by-line and visualizing exactly what happens, including DOM interactions, function calls, and state changes.

## 🚀 Features

- **Line-by-Line Execution**: Highlight the current line being executed.
- **State Inspector**: See variables in real-time across all scopes.
- **Call Stack**: Visualize function calls and returns.
- **Live Preview**: See your HTML and JS interact in an iFrame.
- **Browser APIs**: Supports `prompt()`, `alert()`, `isNaN()`, `parseFloat()`, and `addEventListener()`.

## 🛠️ Usage

### Installation

1. Clone the repository (if applicable) or enter the project directory.
2. Install all necessary dependencies using npm:

```bash
npm install
```

### Running the Tool

To start the development server and open the playground in your browser:

```bash
npm run dev
```

The tool will typically be available at `http://localhost:5173/`.

### How to use it

1. Write your HTML in the **HTML** tab.
2. Write your JavaScript in the **JavaScript** tab.
3. Click **Run Pipeline** to initialize the interpreter.
4. Use **Next Step** to advance through the initialization.
5. Interact with your elements in the **Live Preview** pane to trigger execution frames in the visualizer!

## 📦 Dependencies

- **Acorn**: For parsing JavaScript into an Abstract Syntax Tree (AST).
- **Monaco Editor**: For a premium code editing experience.
- **Vite**: For fast development and bundling.
- **TypeScript**: For type safety and better developer experience.
