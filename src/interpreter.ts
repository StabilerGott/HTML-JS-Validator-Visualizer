import * as acorn from 'acorn';

export type Scope = Record<string, any>;

export interface VariableMetadata {
    kind: 'const' | 'let' | 'var' | 'func';
    label?: string;
}

export interface ExecutionFrame {
    scope: Scope;
    metadata: Record<string, VariableMetadata>;
    nodeQueue: any[];
    isFunction: boolean;
    functionName?: string;
    onReturn?: (value: any) => void;
}

export interface ExecutionState {
    stack: ExecutionFrame[];
    globals: Scope;
    globalMetadata: Record<string, VariableMetadata>;
    logs: string[];
    isFinished: boolean;
    error?: string;
    currentLine: number;
    lastExplanation: string;
}

export class JSInterpreter {
    private ast: any;
    private state: ExecutionState;
    private previewWindow: Window | null = null;
    private onStepCallback?: (state: ExecutionState) => void;

    constructor(code: string, previewIframe?: HTMLIFrameElement) {
        try {
            this.ast = acorn.parse(code, { ecmaVersion: 'latest', locations: true });
        } catch (e: any) {
            throw new Error(`Parse Error: ${e.message}`);
        }

        if (previewIframe) {
            this.previewWindow = previewIframe.contentWindow;
        }

        const globals: Scope = {
            isNaN: (val: any) => isNaN(val),
            parseFloat: (val: any) => parseFloat(val),
            parseInt: (val: any, radix?: number) => parseInt(val, radix),
            alert: (msg: any) => {
                this.log("Alert:", msg);
                if (this.previewWindow) this.previewWindow.alert(msg);
                else alert(msg);
            },
            prompt: (msg: any) => {
                this.log("Prompt:", msg);
                let result;
                if (this.previewWindow) result = this.previewWindow.prompt(msg);
                else result = prompt(msg);
                this.log("Prompt Result:", result);
                return result;
            }
        };

        const globalMetadata: Record<string, VariableMetadata> = {};

        this.state = {
            stack: [{
                scope: globals,
                metadata: globalMetadata,
                nodeQueue: [...this.ast.body],
                isFunction: false
            }],
            globals,
            globalMetadata,
            logs: [],
            isFinished: false,
            currentLine: 1,
            lastExplanation: "Ready to start.",
        };

        // Pre-scan for function declarations
        this.ast.body.forEach((node: any) => {
            if (node.type === 'FunctionDeclaration') {
                this.state.globals[node.id.name] = node;
                this.state.globalMetadata[node.id.name] = { kind: 'func' };
            }
        });
    }

    public step(): ExecutionState {
        if (this.state.isFinished) return this.state;

        const currentFrame = this.getCurrentFrame();
        if (!currentFrame) {
            this.state.isFinished = true;
            return this.state;
        }

        const node = currentFrame.nodeQueue.shift();
        if (!node) {
            this.state.stack.pop();
            return this.step();
        }

        if (node.loc) {
            this.state.currentLine = node.loc.start.line;
        }

        // Generate explanation BEFORE executing (since execution might unshift new nodes)
        this.state.lastExplanation = this.explainNode(node);

        try {
            this.executeNode(node, currentFrame);
        } catch (e: any) {
            this.state.error = e.message;
            this.state.isFinished = true;
        }

        if (['BlockStatement', 'Program'].includes(node.type)) {
            return this.step();
        }

        if (this.onStepCallback) this.onStepCallback(this.state);
        return this.state;
    }

    private explainNode(node: any): string {
        if (!node) return "";

        switch (node.type) {
            case 'VariableDeclaration': {
                const decl = node.declarations[0];
                const kind = node.kind; // const, let, var
                const name = decl.id.name;
                const valueDesc = this.evaluateSimple(decl.init);
                return `Create a ${kind} named <strong>${name}</strong>${valueDesc ? ` and set it to ${valueDesc}` : ''}.`;
            }
            case 'ExpressionStatement':
                return this.explainNode(node.expression);
            case 'AssignmentExpression': {
                const name = node.left.type === 'Identifier' ? node.left.name : 'property';
                const op = node.operator === '=' ? 'to be' : 'by';
                const val = this.evaluateSimple(node.right);
                return `Update <strong>${name}</strong> ${op} ${val}.`;
            }
            case 'CallExpression': {
                const callee = node.callee;
                if (callee.type === 'MemberExpression') {
                    if (callee.object.name === 'document' && callee.property.name === 'getElementById') {
                        return `Find the HTML element with the ID "<strong>${node.arguments[0].value}</strong>".`;
                    }
                    if (callee.object.name === 'document' && callee.property.name === 'querySelector') {
                        return `Find the first HTML element matching the CSS selector "<strong>${node.arguments[0].value}</strong>".`;
                    }
                    if (callee.object.name === 'document' && callee.property.name === 'querySelectorAll') {
                        return `Find ALL HTML elements matching the selector "<strong>${node.arguments[0].value}</strong>".`;
                    }
                    if (callee.property.name === 'addEventListener') {
                        const event = node.arguments[0].value;
                        return `Listen for the "<strong>${event}</strong>" event.`;
                    }
                }
                if (callee.name === 'updateCounter') return "Run the <strong>updateCounter</strong> function.";
                if (callee.name === 'showImg') return "Run the <strong>showImg</strong> function.";
                if (callee.name === 'prompt') return `Ask the user: "${node.arguments[0].value}"`;
                if (callee.name === 'alert') return `Show a message: "${node.arguments[0].value}"`;
                return `Call function <strong>${callee.name || 'anonymous'}</strong>.`;
            }
            case 'IfStatement':
                return `Check if the condition is true.`;
            case 'ForStatement':
                return `Start a loop.`;
            case 'ForLoopCheck':
                return `Check if the loop should continue.`;
            case 'ReturnStatement':
                return `Finish the function and return a value.`;
            case 'FunctionDeclaration':
                return `Define a function named <strong>${node.id.name}</strong>.`;
            case 'UpdateExpression': {
                const name = node.argument.name;
                const op = node.operator === '++' ? 'Increase' : 'Decrease';
                return `${op} <strong>${name}</strong> by 1.`;
            }
            default:
                return `Execute ${node.type}.`;
        }
    }

    // Simple evaluator for explanations to avoid side effects
    private evaluateSimple(node: any): string {
        if (!node) return "";
        if (node.type === 'Literal') return `<strong>${JSON.stringify(node.value)}</strong>`;
        if (node.type === 'Identifier') return `<strong>${node.name}</strong>`;
        if (node.type === 'CallExpression') {
            if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'getElementById') {
                return `element "<strong>${node.arguments[0].value}</strong>"`;
            }
            if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'querySelector') {
                return `element "<strong>${node.arguments[0].value}</strong>"`;
            }
            return `result of ${node.callee.name || 'function'}`;
        }
        return "...";
    }

    public setOnStep(cb: (state: ExecutionState) => void) {
        this.onStepCallback = cb;
    }

    private getCurrentFrame(): ExecutionFrame | null {
        if (this.state.stack.length === 0) return null;
        return this.state.stack[this.state.stack.length - 1];
    }

    private executeNode(node: any, frame: ExecutionFrame) {
        const scope = frame.scope;
        const metadata = frame.metadata;

        switch (node.type) {
            case 'VariableDeclaration':
                node.declarations.forEach((decl: any) => {
                    const value = decl.init ? this.evaluate(decl.init, scope) : undefined;
                    scope[decl.id.name] = value;
                    metadata[decl.id.name] = {
                        kind: node.kind,
                        label: this.getLabel(value)
                    };
                    this.log(`Declared ${decl.id.name} = ${JSON.stringify(value)}`);
                });
                break;

            case 'ExpressionStatement':
                this.evaluate(node.expression, scope);
                break;

            case 'IfStatement':
                const test = this.evaluate(node.test, scope);
                if (test) {
                    frame.nodeQueue.unshift(node.consequent);
                } else if (node.alternate) {
                    frame.nodeQueue.unshift(node.alternate);
                }
                break;

            case 'BlockStatement':
                frame.nodeQueue.unshift(...node.body);
                break;

            case 'ForStatement':
                if (node.init) {
                    if (node.init.type === 'VariableDeclaration') {
                        this.executeNode(node.init, frame);
                    } else {
                        this.evaluate(node.init, scope);
                    }
                }

                const condition = node.test ? this.evaluate(node.test, scope) : true;
                if (condition) {
                    const loopCheckNode = { type: 'ForLoopCheck', original: node, loc: node.test?.loc || node.loc };
                    const updateNode = node.update ? { type: 'ExpressionStatement', expression: node.update, loc: node.update.loc || node.loc } : null;

                    frame.nodeQueue.unshift(loopCheckNode);
                    if (updateNode) frame.nodeQueue.unshift(updateNode);
                    frame.nodeQueue.unshift(node.body);
                }
                break;

            case 'ForLoopCheck':
                const loopCondition = node.original.test ? this.evaluate(node.original.test, scope) : true;
                if (loopCondition) {
                    const updateNode = node.original.update ? { type: 'ExpressionStatement', expression: node.original.update, loc: node.original.update.loc || node.loc } : null;
                    frame.nodeQueue.unshift(node);
                    if (updateNode) frame.nodeQueue.unshift(updateNode);
                    frame.nodeQueue.unshift(node.original.body);
                }
                break;

            case 'ReturnStatement':
                const result = this.evaluate(node.argument, scope);
                this.log(`Returning ${JSON.stringify(result)}`);
                while (this.state.stack.length > 0) {
                    const f = this.state.stack.pop();
                    if (f?.onReturn) f.onReturn(result);
                    if (f?.isFunction) break;
                }
                return result;

            default:
                console.warn('Unhandled node type:', node.type);
        }
    }

    private getLabel(value: any): string | undefined {
        if (value && value.__selector) return `class/id: ${value.__selector}`;
        if (value && value instanceof Array) return `List [${value.length}]`;
        return undefined;
    }

    private evaluate(node: any, scope: Scope): any {
        if (!node) return undefined;

        switch (node.type) {
            case 'Literal':
                return node.value;
            case 'Identifier':
                if (node.name === 'console') return { log: (...args: any[]) => this.log(...args) };
                if (node.name === 'document') {
                    return {
                        getElementById: (id: string) => {
                            if (this.previewWindow) {
                                const el = this.previewWindow.document.getElementById(id);
                                if (el) {
                                    this.log(`Selected element with id: ${id}`);
                                    return this.createDOMProxy(el, `#${id}`);
                                }
                            }
                            this.log(`Element with id ${id} not found`);
                            return null;
                        },
                        querySelector: (selector: string) => {
                            if (this.previewWindow) {
                                const el = this.previewWindow.document.querySelector(selector);
                                if (el) {
                                    this.log(`Selected element: ${selector}`);
                                    return this.createDOMProxy(el, selector);
                                }
                            }
                            return null;
                        },
                        querySelectorAll: (selector: string) => {
                            if (this.previewWindow) {
                                const elements = Array.from(this.previewWindow.document.querySelectorAll(selector));
                                const proxied = elements.map(el => this.createDOMProxy(el, selector));
                                (proxied as any).__selector = selector;
                                return proxied;
                            }
                            return [];
                        }
                    };
                }
                if (node.name in scope) return scope[node.name];
                if (node.name in this.state.globals) return this.state.globals[node.name];
                if (this.previewWindow && node.name in this.previewWindow) {
                    const val = (this.previewWindow as any)[node.name];
                    return typeof val === 'function' ? val.bind(this.previewWindow) : val;
                }
                throw new Error(`${node.name} is not defined`);
            case 'BinaryExpression':
                const left = this.evaluate(node.left, scope);
                const right = this.evaluate(node.right, scope);
                switch (node.operator) {
                    case '+': return left + right;
                    case '-': return left - right;
                    case '*': return left * right;
                    case '/': return left / right;
                    case '===': return left === right;
                    case '!==': return left !== right;
                    case '==': return left == right;
                    case '!=': return left != right;
                    case '<': return left < right;
                    case '>': return left > right;
                    case '<=': return left <= right;
                    case '>=': return left >= right;
                }
                break;
            case 'UpdateExpression':
                const cur = this.evaluate(node.argument, scope);
                let nxt;
                if (node.operator === '++') nxt = cur + 1;
                else if (node.operator === '--') nxt = cur - 1;
                if (node.argument.type === 'Identifier') {
                    scope[node.argument.name] = nxt;
                    return node.prefix ? nxt : cur;
                }
                break;
            case 'AssignmentExpression':
                const rVal = this.evaluate(node.right, scope);
                let finalVal = rVal;

                if (node.operator !== '=') {
                    const currentVal = this.evaluate(node.left, scope);
                    const op = node.operator.slice(0, -1);
                    switch (op) {
                        case '+': finalVal = currentVal + rVal; break;
                        case '-': finalVal = currentVal - rVal; break;
                        case '*': finalVal = currentVal * rVal; break;
                        case '/': finalVal = currentVal / rVal; break;
                    }
                }

                if (node.left.type === 'MemberExpression') {
                    const obj = this.evaluate(node.left.object, scope);
                    const prop = node.left.computed ? this.evaluate(node.left.property, scope) : node.left.property.name;
                    if (obj) {
                        obj[prop] = finalVal;
                        this.log(`Set ${prop} = ${JSON.stringify(finalVal)}`);
                    }
                    return finalVal;
                }
                if (node.left.type === 'Identifier') {
                    const name = node.left.name;
                    if (name in scope) scope[name] = finalVal;
                    else if (name in this.state.globals) this.state.globals[name] = finalVal;
                    else scope[name] = finalVal;
                    this.log(`Assigned ${name} = ${JSON.stringify(finalVal)}`);
                    return finalVal;
                }
                break;
            case 'CallExpression':
                const callee = this.evaluate(node.callee, scope);
                const args = node.arguments.map((arg: any) => this.evaluate(arg, scope));

                if (typeof callee === 'function') {
                    return callee(...args);
                } else if (callee && (callee.type === 'FunctionDeclaration' || callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression')) {
                    this.callFunction(callee, args);
                    return undefined;
                }
                break;
            case 'MemberExpression':
                const o = this.evaluate(node.object, scope);
                if (node.computed) {
                    return o[this.evaluate(node.property, scope)];
                }
                const p = node.property.name;
                const res = o[p];
                return typeof res === 'function' ? res.bind(o) : res;
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                return node;
        }
    }

    private createDOMProxy(el: any, selector: string) {
        return new Proxy(el, {
            get: (target: any, prop: string) => {
                if (prop === '__selector') return selector;
                if (prop === 'addEventListener') {
                    return (type: string, callback: any) => {
                        target.addEventListener(type, () => {
                            this.log(`Triggered ${type} event on ${selector}`);
                            this.callFunction(callback, []);
                            if (this.onStepCallback) this.onStepCallback(this.state);
                        });
                    };
                }
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            },
            set: (target: any, prop: string, value: any) => {
                target[prop] = value;
                return true;
            }
        });
    }

    private callFunction(fnNode: any, args: any[]) {
        this.log(`Calling ${fnNode.id?.name || '(anonymous function)'}(${args.join(', ')})`);
        const functionScope: Scope = { ...this.state.globals };
        const functionMetadata: Record<string, VariableMetadata> = {};

        fnNode.params.forEach((param: any, i: number) => {
            if (param.type === 'Identifier') {
                functionScope[param.name] = args[i];
                functionMetadata[param.name] = { kind: 'var' };
            }
        });

        this.state.stack.push({
            scope: functionScope,
            metadata: functionMetadata,
            nodeQueue: [fnNode.body],
            isFunction: true,
            functionName: fnNode.id?.name
        });

        this.state.isFinished = false;
    }

    private log(...messages: any[]) {
        const formatted = messages.map(m => typeof m === 'object' ? JSON.stringify(m) : String(m)).join(' ');
        this.state.logs.push(formatted);
    }

    public getState(): ExecutionState {
        return this.state;
    }
}
