// 文件: src/providers/VerilogTreeDataProvider.ts (最终修复版 - 文件级作用域)

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CtagsManager, Symbol } from '../ctags';

// 接口定义
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
    ) { }

    getTreeItem(element: ModuleNode): vscode.TreeItem { return element; }

    getChildren(element?: ModuleNode): Thenable<ModuleNode[]> {
        if (!this.workspaceRoot) {
            return Promise.resolve([]);
        }
        if (element) {
            return Promise.resolve(element.children);
        }
        return this.buildTreeFromWorkspace();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    private async buildTreeFromWorkspace(): Promise<ModuleNode[]> {
        await this.ctags.waitForIndex();
        const moduleInfos = new Map<string, ModuleInfo>();
        const workspaceSymbols = this.ctags.getWorkspaceSymbols();
        const lowercaseNameToOriginalNameMap = new Map<string, string>();
        
        // 步骤 1: 收集所有在工作区中定义的模块/实体
        for (const symbolsInFile of workspaceSymbols.values()) {
            for (const symbol of symbolsInFile) {
                if (['module', 'interface', 'entity'].includes(symbol.type)) {
                    if (!moduleInfos.has(symbol.name)) {
                        moduleInfos.set(symbol.name, { symbol, children: [], isInstantiated: false });
                        lowercaseNameToOriginalNameMap.set(symbol.name.toLowerCase(), symbol.name);
                    }
                }
            }
        }

        // 步骤 2: 遍历所有文件，查找实例化关系
        const allFiles = await vscode.workspace.findFiles('**/*.{v,sv,svh,vhd,vhdl}', '**/node_modules/**');
        for (const file of allFiles) {
            const isVHDL = file.path.endsWith('.vhd') || file.path.endsWith('.vhdl');
            const symbolsInFile = workspaceSymbols.get(file.toString()) || [];
            // parentCandidates 现在包含当前文件所有的 module, entity, architecture 符号
            const parentCandidates = symbolsInFile.filter(s => ['module', 'entity', 'architecture'].includes(s.type));
            
            if (parentCandidates.length === 0) {
                continue;
            }

            if (isVHDL) {
                try {
                    const doc = await vscode.workspace.openTextDocument(file);
                    let content = fs.readFileSync(file.fsPath, 'utf8');
                    content = content.replace(/--.*/g, ''); // 移除注释

                    const vhdlInstanceRegex = /\b(\w+)\s*:\s*(?:entity\s+)?(?:work\.)?([\w\d_]+)\s*(?:\(.*\))?\s*?(?:generic\s+map|port\s+map)/gi;
                    
                    let match;
                    while ((match = vhdlInstanceRegex.exec(content)) !== null) {
                        const instanceName = match[1];
                        const moduleTypeName = match[2];
                        if (!instanceName || !moduleTypeName) continue;

                        const originalChildModuleName = lowercaseNameToOriginalNameMap.get(moduleTypeName.toLowerCase());
                        if (!originalChildModuleName) continue;

                        const childModuleInfo = moduleInfos.get(originalChildModuleName);
                        if (!childModuleInfo) continue;
                        
                        const instancePosition = doc.positionAt(match.index);
                        const directParentSymbol = this.findParentModule(instancePosition, parentCandidates);
                        
                        if (!directParentSymbol) continue;

                        // ★★★★★★★★★★★★★★★★★ 核心修复 ★★★★★★★★★★★★★★★★★
                        // 传入 parentCandidates，以便 linkParentAndChild 能在文件上下文中查找
                        this.linkParentAndChild(directParentSymbol, instanceName, childModuleInfo, moduleInfos, lowercaseNameToOriginalNameMap, parentCandidates);
                    }
                } catch (error) {
                    console.error(`[Tree Provider] Error parsing VHDL file ${file.fsPath}:`, error);
                }
            } else {
                // Verilog 逻辑
                for (const symbol of symbolsInFile) {
                    if (symbol.typeRef) {
                        const instantiatedModuleNameRaw = symbol.typeRef.replace(/^(module|entity):/, '');
                        const instanceName = symbol.name;

                        const originalChildModuleName = lowercaseNameToOriginalNameMap.get(instantiatedModuleNameRaw.toLowerCase());
                        if (!originalChildModuleName) continue;

                        const childModuleInfo = moduleInfos.get(originalChildModuleName);
                        if (!childModuleInfo) continue;
                        
                        const directParentSymbol = this.findParentModule(symbol.startPosition, parentCandidates);
                        this.linkParentAndChild(directParentSymbol, instanceName, childModuleInfo, moduleInfos, lowercaseNameToOriginalNameMap, parentCandidates);
                    }
                }
            }
        }
        
        // 步骤 3: 构建最终的树结构
        const rootNodes: ModuleNode[] = [];
        for (const info of moduleInfos.values()) {
            if (!info.isInstantiated) {
                const node = this.createModuleNode(info, moduleInfos, new Set<string>());
                rootNodes.push(node);
            }
        }
        return rootNodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
    }

    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    // ★★★★★★★★★★★★★★★★★   终极修复：全新的 linkParentAndChild   ★★★★★★★★★★★★★★★★★
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    private linkParentAndChild(
        directParentSymbol: Symbol | undefined,
        instanceName: string,
        childModuleInfo: ModuleInfo,
        moduleInfos: Map<string, ModuleInfo>,
        lowercaseMap: Map<string, string>,
        symbolsInFile: Symbol[] // 传入当前文件的所有符号
    ) {
        if (!directParentSymbol) return;
        let logicalParentName: string | undefined;

        if (directParentSymbol.type === 'architecture') {
            // 优先使用 ctags 提供的 scope 信息 (最可靠)
            if (directParentSymbol.scope) { 
                logicalParentName = directParentSymbol.scope;
            } else {
                // 如果 ctags 没有提供，就在当前文件的符号中查找 entity
                // VHDL 保证一个 architecture 对应文件中的一个 entity
                const entityInFile = symbolsInFile.find(s => s.type === 'entity');
                if(entityInFile) {
                    logicalParentName = entityInFile.name;
                }
            }
        } else {
            // 对于 Verilog module 或 VHDL entity，其自身就是逻辑父级
            logicalParentName = directParentSymbol.name;
        }

        if (!logicalParentName) { return; }
        
        const originalParentName = lowercaseMap.get(logicalParentName.toLowerCase());
        if (!originalParentName) { return; }

        const parentModuleInfo = moduleInfos.get(originalParentName);
        if (!parentModuleInfo) { return; }
        
        if (!parentModuleInfo.children.some(child => child.instanceName === instanceName)) {
            parentModuleInfo.children.push({ instanceName: instanceName, moduleName: childModuleInfo.symbol.name });
            childModuleInfo.isInstantiated = true;
        }
    }

    private createModuleNode(info: ModuleInfo, allModules: Map<string, ModuleInfo>, visited: Set<string>): ModuleNode {
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
        const enclosingSymbols = symbols.filter(s => {
            if (!s.endPosition) {
                return false;
            }
            return s.startPosition.isBeforeOrEqual(position) && s.endPosition.isAfterOrEqual(position);
        });

        if (enclosingSymbols.length === 0) {
            return undefined;
        }

        enclosingSymbols.sort((a, b) => b.startPosition.line - a.startPosition.line);
        
        return enclosingSymbols[0];
    }
}

class ModuleNode extends vscode.TreeItem {
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
            if (symbol.type === 'entity') {
                this.iconPath = { light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'vhdl-icon.png'), dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'vhdl-icon.png') };
            } else {
                this.iconPath = { light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'verilog-icon.png'), dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'verilog-icon.png') };
            }
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-method');
        }

        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(symbol.path), { selection: new vscode.Range(symbol.startPosition, symbol.startPosition) }]
        };
        this.contextValue = 'module';
    }
}
