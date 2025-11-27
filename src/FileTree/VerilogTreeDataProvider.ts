// 文件: src/providers/VerilogTreeDataProvider.ts (架构优化版 - 纯数据展示)

import * as vscode from 'vscode';
import * as path from 'path';
import { CtagsManager, Symbol, ModuleReference } from '../ctags';

interface ModuleInfo {
    symbol?: Symbol;
    children: ModuleInstance[];
    isInstantiated: boolean;
    isMissing: boolean;
}

interface ModuleInstance {
    instanceName: string;
    moduleName: string; // The "type" of the module being instantiated
    parentSymbol: Symbol; 
    instancePosition: vscode.Position;
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
        if (!this.workspaceRoot) { return Promise.resolve([]); }
        if (element) { return Promise.resolve(element.children); }
        return this.buildTreeFromWorkspace();
    }

    refresh(): void { this._onDidChangeTreeData.fire(undefined); }

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
                        moduleInfos.set(symbol.name, { symbol, children: [], isInstantiated: false, isMissing: false });
                        lowercaseNameToOriginalNameMap.set(symbol.name.toLowerCase(), symbol.name);
                    }
                }
            }
        }
        
        // 步骤 2: 遍历 CtagsManager 提供的所有实例化关系
        const allReferences = this.ctags.getAllReferences(); 
        
        for (const [moduleTypeName, references] of allReferences.entries()) {
            const originalChildModuleName = lowercaseNameToOriginalNameMap.get(moduleTypeName.toLowerCase());
            let childModuleInfo: ModuleInfo | undefined;

            if (originalChildModuleName) {
                childModuleInfo = moduleInfos.get(originalChildModuleName);
            } else {
                if (!moduleInfos.has(moduleTypeName)) {
                    moduleInfos.set(moduleTypeName, { children: [], isInstantiated: false, isMissing: true });
                }
                childModuleInfo = moduleInfos.get(moduleTypeName);
            }
            if (!childModuleInfo) { continue; }

            for (const ref of references) {
                const symbolsInFile = workspaceSymbols.get(vscode.Uri.file(ref.sourcePath).toString()) || [];
                const parentCandidates = symbolsInFile.filter(s => ['module', 'entity', 'architecture'].includes(s.type));
                const directParentSymbol = this.findParentModule(ref.position, parentCandidates);
                if (!directParentSymbol) { continue; }
                
                // ★★★★★★★★★★★★★★★★★ 核心简化: 直接使用 Ctags 提供的信息 ★★★★★★★★★★★★★★★★★
                // 不再需要任何正则表达式来解析实例名！
                this.linkParentAndChild(
                    directParentSymbol, 
                    ref.instanceName, // 直接从 reference 获取
                    moduleTypeName,   // 直接从 map key 获取
                    childModuleInfo, 
                    moduleInfos, 
                    lowercaseNameToOriginalNameMap, 
                    symbolsInFile,
                    ref.position
                );
            }
        }
        
        // 步骤 3: 构建最终的树结构
        const rootNodes: ModuleNode[] = [];
        for (const [name, info] of moduleInfos.entries()) {
            if (!info.isInstantiated && !info.isMissing) {
                const node = this.createModuleNode(name, info, moduleInfos, new Set<string>());
                rootNodes.push(node);
            }
        }
        return rootNodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
    }
    
    private linkParentAndChild(
        directParentSymbol: Symbol,
        instanceName: string,
        childModuleTypeName: string,
        childModuleInfo: ModuleInfo,
        moduleInfos: Map<string, ModuleInfo>,
        lowercaseMap: Map<string, string>,
        symbolsInFile: Symbol[],
        instancePosition: vscode.Position
    ) {
        let logicalParentName: string | undefined;

        if (directParentSymbol.type === 'architecture') {
            logicalParentName = directParentSymbol.scope || symbolsInFile.find(s => s.type === 'entity')?.name;
        } else {
            logicalParentName = directParentSymbol.name;
        }

        if (!logicalParentName) { return; }
        const originalParentName = lowercaseMap.get(logicalParentName.toLowerCase());
        if (!originalParentName) { return; }
        const parentModuleInfo = moduleInfos.get(originalParentName);
        if (!parentModuleInfo) { return; }
        
        if (!parentModuleInfo.children.some(child => child.instanceName === instanceName && child.parentSymbol.path === directParentSymbol.path)) {
            parentModuleInfo.children.push({ 
                instanceName: instanceName, 
                moduleName: childModuleTypeName, // 使用直接传入的类型名
                parentSymbol: directParentSymbol,
                instancePosition: instancePosition
            });
            childModuleInfo.isInstantiated = true;
        }
    }

    private createModuleNode(moduleName: string, info: ModuleInfo, allModules: Map<string, ModuleInfo>, visited: Set<string>): ModuleNode {
        if (visited.has(moduleName)) {
            const leafNode = new ModuleNode(moduleName, info, vscode.TreeItemCollapsibleState.None, this.context);
            leafNode.label = `${moduleName} (recursive)`;
            leafNode.iconPath = new vscode.ThemeIcon('debug-breakpoint-log-disabled');
            return leafNode;
        }
        
        visited.add(moduleName);
        const hasChildren = info.children.length > 0;
        const collapsibleState = hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        const node = new ModuleNode(moduleName, info, collapsibleState, this.context);

        if (hasChildren) {
            node.children = info.children.map(instance => {
                const childModuleInfo = allModules.get(instance.moduleName);
                if (childModuleInfo) {
                    const childNode = this.createModuleNode(instance.moduleName, childModuleInfo, allModules, new Set(visited));
                    childNode.label = `${instance.instanceName} (${instance.moduleName})`;
                    childNode.contextValue = 'instance';
                    childNode.command = {
                        command: 'vscode.open',
                        title: 'Go to Instantiation',
                        arguments: [vscode.Uri.file(instance.parentSymbol.path), { selection: new vscode.Range(instance.instancePosition, instance.instancePosition) }]
                    };
                    return childNode;
                }
                return null;
            }).filter((n): n is ModuleNode => n !== null);
        }
        return node;
    }

    private findParentModule(position: vscode.Position, symbols: Symbol[]): Symbol | undefined {
        const enclosingSymbols = symbols.filter(s => s.endPosition && s.startPosition.isBeforeOrEqual(position) && s.endPosition.isAfterOrEqual(position));
        if (enclosingSymbols.length === 0) { return undefined; }
        enclosingSymbols.sort((a, b) => (a.endPosition.line - a.startPosition.line) - (b.endPosition.line - b.startPosition.line));
        return enclosingSymbols[0];
    }
}

export class ModuleNode extends vscode.TreeItem {
    children: ModuleNode[] = [];
    public readonly resourceUri?: vscode.Uri;
    constructor(
        public readonly moduleName: string,
        public readonly info: ModuleInfo,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        private readonly context: vscode.ExtensionContext
    ) {
        super(moduleName, collapsibleState);
        
        if (info.isMissing) {
            this.description = `(primitive or missing)`;
            this.tooltip = `Module: ${moduleName}\nStatus: Definition not found in workspace.`;
            this.iconPath = { 
                light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'file_missing.png'), 
                dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'file_missing.png') 
            };
            this.command = undefined;
            this.contextValue = 'missing_module';
        } else if (info.symbol) {
            this.resourceUri = vscode.Uri.file(info.symbol.path);
            this.description = `${path.basename(info.symbol.path)} (${info.symbol.type})`;
            this.tooltip = `Module: ${info.symbol.name}\nType: ${info.symbol.type}\nFile: ${info.symbol.path}`;
            if (info.symbol.type === 'entity') {
                this.iconPath = { light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'vhdl-icon.png'), dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'vhdl-icon.png') };
            } else {
                this.iconPath = { light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'verilog-icon.png'), dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'verilog-icon.png') };
            }
            this.command = {
                command: 'vscode.open',
                title: 'Open Definition',
                arguments: [vscode.Uri.file(info.symbol.path), { selection: new vscode.Range(info.symbol.startPosition, info.symbol.startPosition) }]
            };
            this.contextValue = 'module_with_file';
        }
    }
}
