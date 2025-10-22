# Adolph-Align

![版本](https://img.shields.io/badge/version-1.0.3-blue)![许可证](https://img.shields.io/badge/license-MIT-green)

一款为 Verilog/VHDL 设计的 VS Code 插件，提供一键实例化、代码对齐、文件树导航和信号跳转等功能，旨在提升 HDL 开发效率。

---
## 安装依赖
- **JAVA**:  需要安装依赖[Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack)
---

## 原始代码要求
- **1**: 模块声明支持ANSI和非ANSI风格。
- **2**: 函数、任务声明仅支持非ANSI风格。
- **3**: 内部信号/参数声明要求一个关键字声明一个信号。
- **4**: 尽量每一个地方都添加begin/end关键字。
---

## 现存bug
- **1**: 函数/任务内部的信号声明不支持格式对齐处理。
---

## ✨ 主要功能

### 1. 一键实例化
在光标停止位置 按下`alt + i`,可选择生成当前工作区下的任意verilog模块的实例化内容

### 2. 智能代码对齐
在打开的 Verilog 文件中，按下 `Alt+A` 触发智能对齐。支持以下语法结构：
- `parameter` / `localparam` 参数声明
- `port` 端口声明
- `reg` / `wire` / `integer` / `real` 等内部信号声明
- 二维数组声明
- `assign` 连续赋值语句
- `initial` 过程块
- `always` 进程块（支持 `if-else` / `case` / `for` 的自动缩进）
- 模块实例化
- 门级例化
- `task`/`Function`/`generate`声明

### 3. Verilog 文件树
在侧边栏提供一个清晰的模块/实体层级视图，方便快速导航。

### 4. 定义跳转
-按住 `Ctrl` 并单击信号名，即可跳转到其定义位置。仅支持*.v文件；
-在模块声明之前悬浮显示例化该模块的文件，单击可跳转至该模块被实例化的位置。

### 5. 内置代码片段
提供常用的 Verilog 和 VHDL 代码片段，加速开发。
```c
// Verilog
zhushi、defe_key_word、reg-Signal、reg-x[x:00]  signal
wire-Signal、wire-x[x:00]  signal、task_key_word、case_key_word
input-Signal、input-x[xx:00] Signal
output-s-wire Signal、output-x-wire[xx:00] Signal
output-s-reg Signal、output-x-reg [:00] Signal
repeat_key_word、localparam-c、parameter-c、defparam_key_word
if_a_key_word、else_if_table、else_a_key_word、begin_key_word
jsq、jsq_2level、jsq_3level、shixu-full、shixu-less、Zuhe_logic
module-verilog、my_testbench、head-verilog-self、start_do、ztj_3_level
// VHDL
head-VHDL-self、module-VHDL、vhdl-input-s、vhdl-input-x、vhdl-input-int
vhdl-output-S、vhdl-output-x、vhdl-output-int、vhdl-io-s、vhdl-io-x
vhdl-constant、vhdl-signal-s、vhdl-signal-x、vhdl-signal-int、vhdl-note
vhdl-process-less、vhdl-process-full、vhdl-if-a、vhdl-elsif-a、vhdl-else-b
vhdl-case、vhdl-function、vhdl-procedure、vhdl-component、vhdl-test-bench
vhdl-process-normal、vhdl-file-opt
```
---

## ⚙️ 配置选项

您可以在 VS Code 的设置页面或 `settings.json` 文件中自定义对齐规则。

*提示：每级缩进固定为4个空格，未来可能作为可配置项。*

```json
{
    // 端口对齐 (Port Alignment)
    "verilog.formatter.ast.port_num2": 16, // 行首 -> signed/unsigned
    "verilog.formatter.ast.port_num3": 24, // 行首 -> 位宽 '['
    "verilog.formatter.ast.port_num4": 48, // 行首 -> 信号名
    "verilog.formatter.ast.port_num5": 80, // 行首 -> 行尾符号 (, or ;)

    // 内部信号对齐 (Signal Alignment)
    "verilog.formatter.ast.signal_num2": 16, // 行首 -> signed/unsigned
    "verilog.formatter.ast.signal_num3": 24, // 行首 -> 位宽 '['
    "verilog.formatter.ast.signal_num4": 48, // 行首 -> 变量名
    "verilog.formatter.ast.signal_num5": 80, // 行首 -> 行尾符号 (;)

    // 参数对齐 (Parameter Alignment)
    "verilog.formatter.ast.param_num2": 24, // 行首 -> 参数名
    "verilog.formatter.ast.param_num3": 48, // 行首 -> 赋值符号 (=)
    "verilog.formatter.ast.param_num4": 80, // 行首 -> 行尾符号 (; , or //)

    // Assign 语句对齐 (Assign Statement Alignment)
    "verilog.formatter.ast.assign_num2": 12, // 行首 -> 变量名
    "verilog.formatter.ast.assign_num3": 48, // 行首 -> 赋值符号 (=)
    "verilog.formatter.ast.assign_num4": 80, // 行首 -> 行尾符号 (;)

    // 模块实例化对齐 (Instance Alignment)
    "verilog.formatter.ast.inst_num2": 40, // 端口名 '.' -> 左括号 '('
    "verilog.formatter.ast.inst_num3": 80, // 端口名 '.' -> 右括号 ')'

    // 位宽格式 (Bit-width Formatting)
    "verilog.formatter.ast.upbound": 3, // 位宽 `[]` 内左侧空格数
    "verilog.formatter.ast.lowbound": 3, // 位宽 `[]` 内右侧空格数

    // Always 块对齐 (Always Block Alignment)
    "verilog.formatter.ast.always_lvalue_align": 28, // 左值变量对齐列
    "verilog.formatter.ast.always_op_align": 32,     // 赋值符号对齐列
    "verilog.formatter.ast.always_comment_align": 80, // 行尾注释对齐列

    // Case 语句对齐 (Case Statement Alignment)
    "verilog.formatter.ast.case_colon_align": 20, // 条件 -> 冒号 ':' 对齐列
    "verilog.formatter.ast.case_stmt_align": 28, // 执行语句对齐列
}

```
## ⚠️ 兼容性与依赖

- **平台环境**: 本插件目前仅在win10 x64环境下测试，理论上其他win10、win11环境都支持，linux、mac os等平台暂不支持。

---

## 📜 更新日志
### **v1.0.3**
- **修复**:  修复`always_lvalue_align`，`always_op_align`不生效的问题

### **v1.0.2**
- **新增**:  case 语句新增配置项 `case_stmt_align`用于语句列对齐

### **v1.0.1**
- **修复**:  case 语句的判断选择分支现在支持简单数值、表达式、变量

### **v1.0.0**
- **初版发布**:  需要安装依赖[Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack)

---
## 📦 仓库

项目地址: **[adolph-align on GitHub](https://github.com/Qingling996/HDL-Formatter.git)**

---

## ❤️ 致谢

本插件的开发参考了以下优秀项目：
- [Verilog Hdl Format](https://github.com/1391074994/Verilog-Hdl-Format.git)
- [Verilog-HDL/SystemVerilog/Bluespec SystemVerilog Support](https://github.com/mshr-h/vscode-verilog-hdl-support.git)