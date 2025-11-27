///////////////////////////////////////////////////////////////////////////
/// Project Name         :    
/// Software             : VS Code / Vivado 2018.3 / Modelsim SE 10.6e
/// Target Device        : 
/// Module Name          : Serdes_4b_10to1
/// Upper Level Module   : / 
/// Detail Info          : 串行化发送
///////////////////////////////////////////////////////////////////////////
/// Revision             : <1.0>
/// Revision Date        : <2025-11-27 11:08:16>
/// Author               : Adolph adolph1354238998@gmail.com
/// Revision Detail Info : 
/// <1.0> <2025-11-27>   : 修改
///////////////////////////////////////////////////////////////////////////
`default_nettype none

module serdes_4b_10to1 (
    I_clkx5                                     ,
    I_datain_0                                  ,
    I_datain_1                                  ,
    I_datain_2                                  ,
    I_datain_3                                  ,
    O_dataout_0_p                               ,
    O_dataout_0_n                               ,
    O_dataout_1_p                               ,
    O_dataout_1_n                               ,
    O_dataout_2_p                               ,
    O_dataout_2_n                               ,
    O_dataout_3_p                               ,
    O_dataout_3_n
);

    /* ------------------------------------------------------------------------------------------------  */
    /*                                              端口声明                                              */
    /* ------------------------------------------------------------------------------------------------  */
    input wire                                  I_clkx5                         ; // 5x clock input
    input wire          [09 : 00]               I_datain_0                      ; // input data for serialisation
    input wire          [09 : 00]               I_datain_1                      ; // input data for serialisation
    input wire          [09 : 00]               I_datain_2                      ; // input data for serialisation
    input wire          [09 : 00]               I_datain_3                      ; // input data for serialisation
    output wire                                 O_dataout_0_p                   ; // out DDR data
    output wire                                 O_dataout_0_n                   ; // out DDR data
    output wire                                 O_dataout_1_p                   ; // out DDR data
    output wire                                 O_dataout_1_n                   ; // out DDR data
    output wire                                 O_dataout_2_p                   ; // out DDR data
    output wire                                 O_dataout_2_n                   ; // out DDR data
    output wire                                 O_dataout_3_p                   ; // out DDR data
    output wire                                 O_dataout_3_n                   ; // out DDR data
    /* ------------------------------------------------------------------------------------------------  */
    /*                                              内部信号                                              */
    /* ------------------------------------------------------------------------------------------------  */
    wire                                        S_dataout_0                     ;
    wire                                        S_dataout_1                     ;
    wire                                        S_dataout_2                     ;
    wire                                        S_dataout_3                     ;
    reg                 [02 : 00]               S_TMDS_mod5=0                   ; // 模5计数器
    reg                 [04 : 00]               S_TMDS_shift_0h=0               ;
    reg                 [04 : 00]               S_TMDS_shift_0l=0               ;
    reg                 [04 : 00]               S_TMDS_shift_1h=0               ;
    reg                 [04 : 00]               S_TMDS_shift_1l=0               ;
    reg                 [04 : 00]               S_TMDS_shift_2h=0               ;
    reg                 [04 : 00]               S_TMDS_shift_2l=0               ;
    reg                 [04 : 00]               S_TMDS_shift_3h=0               ;
    reg                 [04 : 00]               S_TMDS_shift_3l=0               ;
    wire                [04 : 00]               S_TMDS_0_l                      ;
    wire                [04 : 00]               S_TMDS_0_h                      ;
    wire                [04 : 00]               S_TMDS_1_l                      ;
    wire                [04 : 00]               S_TMDS_1_h                      ;
    wire                [04 : 00]               S_TMDS_2_l                      ;
    wire                [04 : 00]               S_TMDS_2_h                      ;
    wire                [04 : 00]               S_TMDS_3_l                      ;
    wire                [04 : 00]               S_TMDS_3_h                      ;
    /* ------------------------------------------------------------------------------------------------  */
    /*                                             Main Code                                             */
    /* ------------------------------------------------------------------------------------------------  */
    assign          S_TMDS_0_l                  = { I_datain_0[ 9 ] , I_datain_0[ 7 ] , I_datain_0[ 5 ] , I_datain_0[ 3 ] , I_datain_0[ 1 ] };
    assign          S_TMDS_0_h                  = { I_datain_0[ 8 ] , I_datain_0[ 6 ] , I_datain_0[ 4 ] , I_datain_0[ 2 ] , I_datain_0[ 0 ] };
    assign          S_TMDS_1_l                  = { I_datain_1[ 9 ] , I_datain_1[ 7 ] , I_datain_1[ 5 ] , I_datain_1[ 3 ] , I_datain_1[ 1 ] };
    assign          S_TMDS_1_h                  = { I_datain_1[ 8 ] , I_datain_1[ 6 ] , I_datain_1[ 4 ] , I_datain_1[ 2 ] , I_datain_1[ 0 ] };
    assign          S_TMDS_2_l                  = { I_datain_2[ 9 ] , I_datain_2[ 7 ] , I_datain_2[ 5 ] , I_datain_2[ 3 ] , I_datain_2[ 1 ] };
    assign          S_TMDS_2_h                  = { I_datain_2[ 8 ] , I_datain_2[ 6 ] , I_datain_2[ 4 ] , I_datain_2[ 2 ] , I_datain_2[ 0 ] };
    assign          S_TMDS_3_l                  = { I_datain_3[ 9 ] , I_datain_3[ 7 ] , I_datain_3[ 5 ] , I_datain_3[ 3 ] , I_datain_3[ 1 ] };
    assign          S_TMDS_3_h                  = { I_datain_3[ 8 ] , I_datain_3[ 6 ] , I_datain_3[ 4 ] , I_datain_3[ 2 ] , I_datain_3[ 0 ] };

    always @(posedge I_clkx5) begin
        S_TMDS_mod5         <=    ( S_TMDS_mod5[ 2 ] ) ? 3'd0 : S_TMDS_mod5+3'd1;
        S_TMDS_shift_0h     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_0_h : S_TMDS_shift_0h[ 4 : 1 ];
        S_TMDS_shift_0l     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_0_l : S_TMDS_shift_0l[ 4 : 1 ];
        S_TMDS_shift_1h     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_1_h : S_TMDS_shift_1h[ 4 : 1 ];
        S_TMDS_shift_1l     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_1_l : S_TMDS_shift_1l[ 4 : 1 ];
        S_TMDS_shift_2h     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_2_h : S_TMDS_shift_2h[ 4 : 1 ];
        S_TMDS_shift_2l     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_2_l : S_TMDS_shift_2l[ 4 : 1 ];
        S_TMDS_shift_3h     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_3_h : S_TMDS_shift_3h[ 4 : 1 ];
        S_TMDS_shift_3l     <=    ( S_TMDS_mod5[ 2 ] ) ? S_TMDS_3_l : S_TMDS_shift_3l[ 4 : 1 ];
    end
    /* ------------------------------------------------------------------------------------------------  */
    /*                                              模块例化                                              */
    /* ------------------------------------------------------------------------------------------------  */
    /////////////////////////////////////////////////////////////////////////////////
    //Altera FPGA DDIO
    /////////////////////////////////////////////////////////////////////////////////

    altddio_out altddio_out_0 (
        .datain_h                       ({ S_TMDS_shift_3h[ 0 ] , S_TMDS_shift_2h[ 0 ] , S_TMDS_shift_1h[ 0 ] , S_TMDS_shift_0h[ 0 ] }),
        .datain_l                       ({ S_TMDS_shift_3l[ 0 ] , S_TMDS_shift_2l[ 0 ] , S_TMDS_shift_1l[ 0 ] , S_TMDS_shift_0l[ 0 ] }),
        .outclock                       (I_clkx5                                ),
        .dataout                        ({ O_dataout_3_p , O_dataout_2_p , O_dataout_1_p , O_dataout_0_p }),
        .aclr                           (1'b0                                   ),
        .aset                           (1'b0                                   ),
        .oe                             (1'b1                                   ),
        .oe_out                         (                                       ),
        .outclocken                     (1'b1                                   ),
        .sclr                           (1'b0                                   ),
        .sset                           (1'b0                                   )
    );
    assign          altddio_out_0.extend_oe_disable = "OFF"                     ;
    assign          altddio_out_0.invert_output = "OFF"                         ;
    assign          altddio_out_0.lpm_hint      = "UNUSED"                      ;
    assign          altddio_out_0.lpm_type      = "altddio_out"                 ;
    assign          altddio_out_0.oe_reg        = "UNREGISTERED"                ;
    assign          altddio_out_0.power_up_high = "OFF"                         ;
    assign          altddio_out_0.width         = 4                             ;

    altddio_out altddio_out_1 (
        .datain_h                       (~{ S_TMDS_shift_3h[ 0 ] , S_TMDS_shift_2h[ 0 ] , S_TMDS_shift_1h[ 0 ] , S_TMDS_shift_0h[ 0 ] }),
        .datain_l                       (~{ S_TMDS_shift_3l[ 0 ] , S_TMDS_shift_2l[ 0 ] , S_TMDS_shift_1l[ 0 ] , S_TMDS_shift_0l[ 0 ] }),
        .outclock                       (I_clkx5                                ),
        .dataout                        ({ O_dataout_3_n , O_dataout_2_n , O_dataout_1_n , O_dataout_0_n }),
        .aclr                           (1'b0                                   ),
        .aset                           (1'b0                                   ),
        .oe                             (1'b1                                   ),
        .oe_out                         (                                       ),
        .outclocken                     (1'b1                                   ),
        .sclr                           (1'b0                                   ),
        .sset                           (1'b0                                   )
    );
    assign          altddio_out_1.extend_oe_disable = "OFF"                     ;
    assign          altddio_out_1.invert_output = "OFF"                         ;
    assign          altddio_out_1.lpm_hint      = "UNUSED"                      ;
    assign          altddio_out_1.lpm_type      = "altddio_out"                 ;
    assign          altddio_out_1.oe_reg        = "UNREGISTERED"                ;
    assign          altddio_out_1.power_up_high = "OFF"                         ;
    assign          altddio_out_1.width         = 4                             ;
    /////////////////////////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////////
    //Xilinx FPGA ODDR
    /////////////////////////////////////////////////////////////////////////////////

    ODDR #(
        .DDR_CLK_EDGE                   ("SAME_EDGE"                            ), // "OPPOSITE_EDGE" or "SAME_EDGE"
        .INIT                           (1'b0                                   ), // Initial value of Q: 1'b0 or 1'b1
        .SRTYPE                         ("SYNC"                                 ) // Set/Reset type: "SYNC" or "ASYNC"
    ) UUT0_ODDR (
        .Q                              (S_dataout_0                            ), // 1-bit DDR output
        .C                              (I_clkx5                                ), // 1-bit clock input
        .CE                             (1'b1                                   ), // 1-bit clock enable input
        .D1                             (S_TMDS_shift_0h[ 0 ]                   ), // 1-bit data input (positive edge)
        .D2                             (S_TMDS_shift_0l[ 0 ]                   ), // 1-bit data input (negative edge)
        .R                              (1'b0                                   ), // 1-bit reset
        .S                              (1'b0                                   ) // 1-bit set
    );

    OBUFDS #(
        .IOSTANDARD                     ("DEFAULT"                              ), // Specify the output I/O standard
        .SLEW                           ("SLOW"                                 ) // Specify the output slew rate
    ) UUT0_OBUFDS (
        .O                              (O_dataout_0_p                          ), // Diff_p output (connect directly to top-level port)
        .OB                             (O_dataout_0_n                          ), // Diff_n output (connect directly to top-level port)
        .I                              (S_dataout_0                            ) // Buffer input
    );

    ODDR #(
        .DDR_CLK_EDGE                   ("SAME_EDGE"                            ), // "OPPOSITE_EDGE" or "SAME_EDGE"
        .INIT                           (1'b0                                   ), // Initial value of Q: 1'b0 or 1'b1
        .SRTYPE                         ("SYNC"                                 ) // Set/Reset type: "SYNC" or "ASYNC"
    ) UUT1_ODDR (
        .Q                              (S_dataout_1                            ), // 1-bit DDR output
        .C                              (I_clkx5                                ), // 1-bit clock input
        .CE                             (1'b1                                   ), // 1-bit clock enable input
        .D1                             (S_TMDS_shift_1h[ 0 ]                   ), // 1-bit data input (positive edge)
        .D2                             (S_TMDS_shift_1l[ 0 ]                   ), // 1-bit data input (negative edge)
        .R                              (1'b0                                   ), // 1-bit reset
        .S                              (1'b0                                   ) // 1-bit set
    );

    OBUFDS #(
        .IOSTANDARD                     ("DEFAULT"                              ), // Specify the output I/O standard
        .SLEW                           ("SLOW"                                 ) // Specify the output slew rate
    ) UUT1_OBUFDS (
        .O                              (O_dataout_1_p                          ), // Diff_p output (connect directly to top-level port)
        .OB                             (O_dataout_1_n                          ), // Diff_n output (connect directly to top-level port)
        .I                              (S_dataout_1                            ) // Buffer input
    );

    ODDR #(
        .DDR_CLK_EDGE                   ("SAME_EDGE"                            ), // "OPPOSITE_EDGE" or "SAME_EDGE"
        .INIT                           (1'b0                                   ), // Initial value of Q: 1'b0 or 1'b1
        .SRTYPE                         ("SYNC"                                 ) // Set/Reset type: "SYNC" or "ASYNC"
    ) UUT2_ODDR (
        .Q                              (S_dataout_2                            ), // 1-bit DDR output
        .C                              (I_clkx5                                ), // 1-bit clock input
        .CE                             (1'b1                                   ), // 1-bit clock enable input
        .D1                             (S_TMDS_shift_2h[ 0 ]                   ), // 1-bit data input (positive edge)
        .D2                             (S_TMDS_shift_2l[ 0 ]                   ), // 1-bit data input (negative edge)
        .R                              (1'b0                                   ), // 1-bit reset
        .S                              (1'b0                                   ) // 1-bit set
    );

    OBUFDS #(
        .IOSTANDARD                     ("DEFAULT"                              ), // Specify the output I/O standard
        .SLEW                           ("SLOW"                                 ) // Specify the output slew rate
    ) UUT2_OBUFDS (
        .O                              (O_dataout_2_p                          ), // Diff_p output (connect directly to top-level port)
        .OB                             (O_dataout_2_n                          ), // Diff_n output (connect directly to top-level port)
        .I                              (S_dataout_2                            ) // Buffer input
    );

    ODDR #(
        .DDR_CLK_EDGE                   ("SAME_EDGE"                            ), // "OPPOSITE_EDGE" or "SAME_EDGE"
        .INIT                           (1'b0                                   ), // Initial value of Q: 1'b0 or 1'b1
        .SRTYPE                         ("SYNC"                                 ) // Set/Reset type: "SYNC" or "ASYNC"
    ) UUT3_ODDR (
        .Q                              (S_dataout_3                            ), // 1-bit DDR output
        .C                              (I_clkx5                                ), // 1-bit clock input
        .CE                             (1'b1                                   ), // 1-bit clock enable input
        .D1                             (S_TMDS_shift_3h[ 0 ]                   ), // 1-bit data input (positive edge)
        .D2                             (S_TMDS_shift_3l[ 0 ]                   ), // 1-bit data input (negative edge)
        .R                              (1'b0                                   ), // 1-bit reset
        .S                              (1'b0                                   ) // 1-bit set
    );

    OBUFDS #(
        .IOSTANDARD                     ("DEFAULT"                              ), // Specify the output I/O standard
        .SLEW                           ("SLOW"                                 ) // Specify the output slew rate
    ) UUT3_OBUFDS (
        .O                              (O_dataout_3_p                          ), // Diff_p output (connect directly to top-level port)
        .OB                             (O_dataout_3_n                          ), // Diff_n output (connect directly to top-level port)
        .I                              (S_dataout_3                            ) // Buffer input
    );

endmodule
`default_nettype wire
