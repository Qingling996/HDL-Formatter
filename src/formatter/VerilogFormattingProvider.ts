import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Logger } from '../logger'; 
import { AstNode } from './ast-types';
import { generateVerilogFromAST } from './astProcessor';

const execPromise = promisify(exec);

export class VerilogFormattingProvider implements vscode.DocumentFormattingEditProvider {
    private jarPath: string;
    private logger: Logger;

    constructor(jarPath: string, logger: Logger) {
        this.jarPath = jarPath;
        this.logger = logger; // 存储 logger 实例
        this.logger.info(`VerilogFormattingProvider initialized with JAR path: ${this.jarPath}`); 
    }

    public async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[] | null> {

        this.logger.info('--- Formatting Process Started ---'); // 1. 确认方法被调用

        const config = vscode.workspace.getConfiguration('verilog.formatter.ast');

        const jarPath = this.jarPath;
        if (!fs.existsSync(jarPath)) {
            const errorMsg = `FATAL: Verilog parser JAR not found at ${jarPath}.`;
            vscode.window.showErrorMessage(errorMsg);
            this.logger.error(errorMsg);
        }

        const tempVerilogFile = path.join(os.tmpdir(), `Adolph_Hdl_Temp.v`);
        const tempJsonFile = path.join(os.tmpdir(), `Adolph_Hdl_Temp.json`);
        const originalText = document.getText();
        
        try {
            this.logger.info('[1/3] Writing source to temporary file.');
            fs.writeFileSync(tempVerilogFile, originalText, 'utf-8');

            const command = `java -jar "${jarPath}" "${tempVerilogFile}" "${tempJsonFile}"`;

            this.logger.info(`Executing parser command: ${command}`);
            const { stdout, stderr } = await execPromise(command, { timeout: 5000 });

            if (stdout) {
                this.logger.info(`Parser stdout: ${stdout}`);
            }
            if (stderr) {
                this.logger.warn(`Parser stderr: ${stderr}`);
            }

            this.logger.info(`[2/3] Checking for output file: ${tempJsonFile}`);
            if (!fs.existsSync(tempJsonFile)) {
                throw new Error(`Parser did not generate an output JSON file. Stderr: ${stderr}`);
            }

            const astJsonContent = fs.readFileSync(tempJsonFile, 'utf-8');
            if (!astJsonContent) {
                throw new Error('Parser generated an empty JSON file.');
            }

            const ast: AstNode = JSON.parse(astJsonContent);

            this.logger.info('[3/3] Generating formatted text from AST.');
            const formattedText = generateVerilogFromAST(ast, config);

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(originalText.length)
            );

            this.logger.info('--- AST Formatting process successful ---');
            return [vscode.TextEdit.replace(fullRange, formattedText)];

            } catch (error: any) {
                this.logger.error("--- AST Formatting process FAILED ---");
                this.logger.error("Error object:", error);

                let errorMessage: string;
                if (error.killed) {
                errorMessage = `The parser process was killed, possibly due to a timeout (5 seconds).`;
            } else if (error.stderr) {
                errorMessage = `Parser process exited with an error. Details: ${error.stderr}`;
            } else if (error.stdout) {
                errorMessage = `Parser process exited with an error. Details: ${error.stdout}`;
            } else {
                errorMessage = error.message || 'An unknown error occurred during parsing.';
            }

            vscode.window.showErrorMessage(`Verilog Parser Failed: ${errorMessage}`);

            return null; 
            } finally {
                // 清理临时文件-调试使用-发布版开启
                if (fs.existsSync(tempVerilogFile)) {
                    fs.unlinkSync(tempVerilogFile);
                }
                if (fs.existsSync(tempJsonFile)) {
                    fs.unlinkSync(tempJsonFile);
                }
            this.logger.info('Cleaned Temp File.');
        }
    }
}