// 文件: src/FileTree/VerilogTreeDataProvider.ts (已修复)

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CtagsManager, Symbol } from '../ctags';

interface ModuleInfo {
symbol: Symbol;
children: ModuleInstance[];
isInstantiated: boolean;
}

interface ModuleInstance {
instanceName: string;
moduleName: string;
}

export class VerilogTreeDataProvider implements vscode.TreeDataProvider<ModuleNode> {
private _onDidChangeTreeData: vscode.EventEmitter<ModuleNode | undefined> = new vscode.EventEmitter<ModuleNode | undefined>();
readonly onDidChangeTreeData: vscode.Event<ModuleNode | undefined> = this._onDidChangeTreeData.event;

constructor(
private workspaceRoot: string,
private ctags: CtagsManager,
private context: vscode.ExtensionContext
) {}

getTreeItem(element: ModuleNode): vscode.TreeItem {
return element;
}

getChildren(element?: ModuleNode): Thenable<ModuleNode[]> {
if (!this.workspaceRoot) { return Promise.resolve([]); }
if (element) { return Promise.resolve(element.children); }
return this.buildTreeFromWorkspace();
}

refresh(): void {
this._onDidChangeTreeData.fire(undefined);
}

private async buildTreeFromWorkspace(): Promise<ModuleNode[]> {
// ★★★ 核心修改：等待后台索引完成
await this.ctags.waitForIndex();

const moduleInfos = new Map<string, ModuleInfo>();

// ★★★ 核心修改：直接从 CtagsManager 获取整个工作区的符号
const workspaceSymbols = this.ctags.getWorkspaceSymbols();

// === 步骤 1: 从缓存中扫描所有模块定义 ===
for (const symbolsInFile of workspaceSymbols.values()) {
for (const symbol of symbolsInFile) {
if (['module', 'interface', 'entity'].includes(symbol.type)) {
if (!moduleInfos.has(symbol.name)) {
moduleInfos.set(symbol.name, { 
symbol, 
children: [], 
isInstantiated: false 
});
}
}
}
}

// === 步骤 2: 扫描实例化关系 (正则部分保持不变) ===
const instanceRegex = /\b(\w+)\b\s*(?:#\s*\([^;]*\))?\s*\b(\w+)\b\s*\(/g;

// 依然需要遍历文件来读取内容，但不再需要调用 getSymbols
const files = await vscode.workspace.findFiles('**/*.{v,sv,vh,svh,vhd,vhdl}', '**/node_modules/**');

for (const file of files) {
try {
const doc = await vscode.workspace.openTextDocument(file);
let content = fs.readFileSync(file.fsPath, 'utf8');
content = content.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));

// ★★★ 核心修改：从缓存中获取父模块符号，而不是重新解析
const parentSymbols = (workspaceSymbols.get(file.toString()) || [])
.filter(s => s.type === 'module');

if (parentSymbols.length === 0) continue;

// 正则匹配和括号扫描的逻辑保持不变...
let match;
while ((match = instanceRegex.exec(content)) !== null) {
const moduleTypeName = match[1];
const instanceName = match[2];

if (['always', 'initial', 'if', 'for', 'case', 'module', 'begin', 'end', 'generate', 'assign', 'function', 'task'].includes(moduleTypeName)) continue;

const instantiatedModuleInfo = moduleInfos.get(moduleTypeName);
if (!instantiatedModuleInfo) continue;

const startIndex = match.index + match[0].length;
let balance = 1;
let endIndex = -1;
for (let i = startIndex; i < content.length; i++) {
if (content[i] === '/' && content[i+1] === '/') {
while(i < content.length && content[i] !== '\n') i++;
if (i >= content.length) break;
}
if (content[i] === '(') balance++;
else if (content[i] === ')') balance--;
if (balance === 0) { endIndex = i; break; }
}
if (endIndex === -1) continue;
let foundSemicolon = false;
for (let i = endIndex + 1; i < content.length; i++) {
const char = content[i];
if (char === ';') { foundSemicolon = true; break; }
if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') break;
}
if (!foundSemicolon) continue;

const instancePosition = doc.positionAt(match.index);
const parentModuleSymbol = this.findParentModule(instancePosition, parentSymbols);

if (parentModuleSymbol) {
const parentModuleInfo = moduleInfos.get(parentModuleSymbol.name);
if (parentModuleInfo) {
if (!parentModuleInfo.children.some(child => child.instanceName === instanceName && child.moduleName === moduleTypeName)) {
parentModuleInfo.children.push({ instanceName, moduleName: moduleTypeName });
instantiatedModuleInfo.isInstantiated = true;
}
}
}
}
} catch (error) {
console.error(`[Step 2] Error parsing instances in ${file.fsPath}:`, error);
}
}

// === 步骤 3: 构建树 (保持不变) ===
const rootNodes: ModuleNode[] = [];
for (const [name, info] of moduleInfos.entries()) {
if (!info.isInstantiated) {
const node = this.createModuleNode(info, moduleInfos, new Set<string>());
rootNodes.push(node);
}
}
return rootNodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
}

private createModuleNode(info: ModuleInfo, allModules: Map<string, ModuleInfo>, visited: Set<string>): ModuleNode {
// ... 此方法保持不变 ...
if (visited.has(info.symbol.name)) {
const leafNode = new ModuleNode(info.symbol, vscode.TreeItemCollapsibleState.None, true, this.context);
leafNode.label = `${info.symbol.name} (recursive)`;
leafNode.iconPath = new vscode.ThemeIcon('debug-breakpoint-log-disabled');
return leafNode;
}
visited.add(info.symbol.name);
const hasChildren = info.children.length > 0;
const collapsibleState = hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
const node = new ModuleNode(info.symbol, collapsibleState, true, this.context);
if (hasChildren) {
node.children = info.children.map(instance => {
const childModuleInfo = allModules.get(instance.moduleName);
if (childModuleInfo) {
const childNode = this.createModuleNode(childModuleInfo, allModules, new Set(visited));
childNode.label = `${instance.instanceName} (${instance.moduleName})`;
childNode.contextValue = 'instance';
return childNode;
}
return null;
}).filter((n): n is ModuleNode => n !== null);
}
return node;
}

private findParentModule(position: vscode.Position, symbols: Symbol[]): Symbol | undefined {
// ... 此方法保持不变 ...
let bestMatch: Symbol | undefined;
for (const symbol of symbols) {
// 注意：findParentModule 依赖 endPosition，确保 calculateEndPositions 已被正确处理
const symbolRange = new vscode.Range(symbol.startPosition, symbol.endPosition);
if (symbolRange.contains(position)) {
if (!bestMatch || new vscode.Range(bestMatch.startPosition, bestMatch.endPosition).contains(symbolRange)) {
bestMatch = symbol;
}
}
}
return bestMatch;
}
}

// ModuleNode 类保持不变
class ModuleNode extends vscode.TreeItem {
// ...
children: ModuleNode[] = [];
constructor(
public readonly symbol: Symbol,
public readonly collapsibleState: vscode.TreeItemCollapsibleState,
public readonly isModule: boolean,
private readonly context: vscode.ExtensionContext
) {
super(symbol.name, collapsibleState);

this.description = `${path.basename(symbol.path)} (${symbol.type})`;
this.tooltip = `Module: ${symbol.name}\nType: ${symbol.type}\nFile: ${symbol.path}`;

if (this.isModule) {
this.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'images', 'verilog-icon.png');
} else {
this.iconPath = new vscode.ThemeIcon('symbol-method');
}

this.command = {
command: 'vscode.open',
title: 'Open File',
arguments: [vscode.Uri.file(symbol.path), {
selection: new vscode.Range(symbol.startPosition, symbol.startPosition)
}]
};
this.contextValue = 'module';
}
}
