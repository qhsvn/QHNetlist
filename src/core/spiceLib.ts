// Mô hình và subcircuit SPICE tin cậy, cố định trong mã nguồn (không nhận chuỗi SPICE thô từ người dùng/AI).
// Các mô hình IC là mô hình hành vi (behavioral) đơn giản hoá: đủ để học và thử nghiệm, không thay datasheet.

/** .model theo tên. Giá trị tham số lấy từ mô hình công khai phổ biến hoặc xấp xỉ theo datasheet. */
export const SPICE_MODELS: Record<string, string> = {
  // diode tín hiệu / chỉnh lưu
  D1N4148: '.model D1N4148 D(IS=2.52n RS=0.568 N=1.752 CJO=4p M=0.4 TT=20n BV=100 IBV=100u)',
  D1N4007: '.model D1N4007 D(IS=7.02767n RS=0.0341512 N=1.80803 CJO=1e-11 M=0.3 BV=1000 IBV=5u)',
  D1N5408: '.model D1N5408 D(IS=63n RS=14.1m N=1.7 CJO=53p M=0.333 BV=1000 IBV=10u TT=5.7u)',
  // schottky
  D1N5819: '.model D1N5819 D(IS=31.7u RS=0.051 N=1.373 CJO=110p M=0.35 BV=40 IBV=1m EG=0.69)',
  D1N5822: '.model D1N5822 D(IS=126u RS=0.016 N=1.4 CJO=300p M=0.4 BV=40 IBV=1m EG=0.69)',
  DBAT54: '.model DBAT54 D(IS=0.1u RS=1.5 N=1.03 CJO=10p M=0.33 BV=30 IBV=10u EG=0.69)',
  // zener
  DZ3V3: '.model DZ3V3 D(IS=1e-11 RS=2 N=1.5 BV=3.3 IBV=20m NBV=3 CJO=400p)',
  DZ5V1: '.model DZ5V1 D(IS=1e-11 RS=1 N=1.5 BV=5.1 IBV=5m NBV=1.2 CJO=200p)',
  DZ9V1: '.model DZ9V1 D(IS=1e-11 RS=1 N=1.5 BV=9.1 IBV=5m NBV=1 CJO=100p)',
  DZ12V: '.model DZ12V D(IS=1e-11 RS=1 N=1.5 BV=12 IBV=5m NBV=1 CJO=80p)',
  DZ15V: '.model DZ15V D(IS=1e-11 RS=1.5 N=1.5 BV=15 IBV=5m NBV=1 CJO=70p)',
  // LED
  LED_RED: '.model LED_RED D(IS=1e-22 N=1.5 RS=5 BV=5 IBV=10u)',
  LED_GREEN: '.model LED_GREEN D(IS=1e-27 N=1.6 RS=5 BV=5 IBV=10u)',
  LED_BLUE: '.model LED_BLUE D(IS=1e-30 N=1.8 RS=8 BV=5 IBV=10u)',
  LED_YELLOW: '.model LED_YELLOW D(IS=1e-23 N=1.55 RS=5 BV=5 IBV=10u)',
  LED_WHITE: '.model LED_WHITE D(IS=1e-30 N=1.85 RS=8 BV=5 IBV=10u)',
  // BJT
  Q2N3904: '.model Q2N3904 NPN(IS=6.734f XTI=3 EG=1.11 VAF=74.03 BF=416.4 NE=1.259 ISE=6.734f IKF=66.78m XTB=1.5 BR=.7371 NC=2 ISC=0 IKR=0 RC=1 CJC=3.638p MJC=.3085 VJC=.75 FC=.5 CJE=4.493p MJE=.2593 VJE=.75 TR=239.5n TF=301.2p ITF=.4 VTF=4 XTF=2 RB=10)',
  Q2N2222A: '.model Q2N2222A NPN(IS=14.34f XTI=3 EG=1.11 VAF=74.03 BF=255.9 NE=1.307 ISE=14.34f IKF=.2847 XTB=1.5 BR=6.092 NC=2 ISC=0 IKR=0 RC=1 CJC=7.306p MJC=.3416 VJC=.75 FC=.5 CJE=22.01p MJE=.377 VJE=.75 TR=46.91n TF=411.1p ITF=.6 VTF=1.7 XTF=3 RB=10)',
  QBC547B: '.model QBC547B NPN(IS=2.39E-14 NF=1.008 ISE=3.545E-15 NE=1.541 BF=294.3 IKF=0.1357 VAF=63.2 NR=1.004 ISC=6.272E-14 NC=1.243 BR=7.946 IKR=0.1144 VAR=25.9 RB=1 IRB=1E-06 RBM=1 RE=0.4683 RC=0.85 XTB=0 EG=1.11 XTI=3 CJE=1.358E-11 VJE=0.65 MJE=0.3279 TF=4.391E-10 XTF=120 VTF=2.643 ITF=0.7495 PTF=0 CJC=3.728E-12 VJC=0.3997 MJC=0.2955 XCJC=0.6193 TR=1E-32 CJS=0 VJS=0.75 MJS=0.333 FC=0.9579)',
  QTIP31C: '.model QTIP31C NPN(IS=1.8e-12 BF=50 VAF=100 IKF=3 RB=0.5 RC=0.05 RE=0.05 CJE=300p CJC=100p TF=20n)',
  Q2N3906: '.model Q2N3906 PNP(IS=1.41f XTI=3 EG=1.11 VAF=18.7 BF=180.7 NE=1.5 ISE=0 IKF=80m XTB=1.5 BR=4.977 NC=2 ISC=0 IKR=0 RC=2.5 CJC=9.728p MJC=.5776 VJC=.75 FC=.5 CJE=8.063p MJE=.3677 VJE=.75 TR=33.42n TF=179.3p ITF=.4 VTF=4 XTF=6 RB=10)',
  Q2N2907A: '.model Q2N2907A PNP(IS=650.6E-18 XTI=3 EG=1.11 VAF=115.7 BF=231.7 NE=1.829 ISE=54.81f IKF=1.079 XTB=1.5 BR=3.563 NC=2 ISC=0 IKR=0 RC=.715 CJC=14.76p MJC=.5383 VJC=.75 FC=.5 CJE=19.82p MJE=.3357 VJE=.75 TR=111.3n TF=603.7p ITF=.65 VTF=5 XTF=1.7 RB=10)',
  QBC557B: '.model QBC557B PNP(IS=3.83E-14 NF=1.008 ISE=1.22E-14 NE=1.528 BF=344.4 IKF=0.08039 VAF=21.11 NR=1.005 ISC=2.85E-13 NC=1.28 BR=14.84 IKR=0.047 VAR=32.02 RB=1 RE=0.6202 RC=0.5713 CJE=1.23E-11 VJE=0.6106 MJE=0.378 TF=5.6E-10 XTF=3.414 VTF=5.23 ITF=0.1483 CJC=1.08E-11 VJC=0.1022 MJC=0.3563 XCJC=0.6288 FC=0.8027)',
  QTIP32C: '.model QTIP32C PNP(IS=1.8e-12 BF=50 VAF=100 IKF=3 RB=0.5 RC=0.05 RE=0.05 CJE=300p CJC=100p TF=20n)',
  // MOSFET công suất (VDMOS của ngspice)
  M2N7000: '.model M2N7000 VDMOS(Rg=3 Vto=1.6 Rd=0 Rs=.205 Rb=.5 Kp=.32 Cgdmax=67p Cgdmin=12p Cgs=50p Cjo=50p Is=5f Ksubthres=.1)',
  MBS170: '.model MBS170 VDMOS(Rg=3 Vto=1.8 Rd=0.5 Rs=.5 Kp=.25 Cgdmax=40p Cgdmin=8p Cgs=30p Cjo=40p Is=5f)',
  MIRF540N: '.model MIRF540N VDMOS(Rg=3 Vto=3.5 Rd=12m Rs=10m Kp=35 Cgdmax=1.2n Cgdmin=60p Cgs=1.7n Cjo=1n Is=10p Ksubthres=.1)',
  MIRLZ44N: '.model MIRLZ44N VDMOS(Rg=2 Vto=1.6 Rd=8m Rs=6m Kp=80 Cgdmax=1.4n Cgdmin=80p Cgs=1.7n Cjo=1.2n Is=10p Ksubthres=.1)',
  MIRF3205: '.model MIRF3205 VDMOS(Rg=2 Vto=3 Rd=3m Rs=2m Kp=120 Cgdmax=2.5n Cgdmin=150p Cgs=3.2n Cjo=2n Is=10p Ksubthres=.1)',
  MBS250: '.model MBS250 VDMOS(pchan Rg=3 Vto=-2.2 Rd=1 Rs=1 Kp=.2 Cgdmax=40p Cgdmin=8p Cgs=30p Cjo=40p Is=5f)',
  MIRF9540: '.model MIRF9540 VDMOS(pchan Rg=3 Vto=-3.5 Rd=0.05 Rs=0.04 Kp=10 Cgdmax=1.2n Cgdmin=100p Cgs=1.4n Cjo=800p Is=1p)',
  MIRF4905: '.model MIRF4905 VDMOS(pchan Rg=2 Vto=-3 Rd=6m Rs=5m Kp=60 Cgdmax=2.5n Cgdmin=150p Cgs=3n Cjo=2n Is=10p)',
  // JFET
  J2N5457: '.model J2N5457 NJF(Beta=1.125m Betatce=-.5 Rd=1 Rs=1 Lambda=2.3m Vto=-1.372 Vtotc=-2.5m Is=181.3f Xti=3 Cgd=2.2p M=.3349 Pb=1 Fc=.5 Cgs=2.8p)',
  JJ310: '.model JJ310 NJF(Beta=3.8m Rd=1 Rs=1 Lambda=20m Vto=-3 Is=1f Cgd=2p Cgs=5p)',
  J2N5460: '.model J2N5460 PJF(Beta=1m Rd=1 Rs=1 Lambda=10m Vto=-2.5 Is=1f Cgd=5p Cgs=6p)',
};

/** Tham số Shockley cho bộ giải tích hợp (bỏ qua điện dung). BV: điện áp đánh thủng cho zener. */
export const DIODE_PARAMS: Record<string, { IS: number; N: number; RS: number; BV?: number }> = {
  D1N4148: { IS: 2.52e-9, N: 1.752, RS: 0.568 },
  D1N4007: { IS: 7.02767e-9, N: 1.80803, RS: 0.0341512 },
  D1N5408: { IS: 63e-9, N: 1.7, RS: 0.0141 },
  D1N5819: { IS: 31.7e-6, N: 1.373, RS: 0.051 },
  D1N5822: { IS: 126e-6, N: 1.4, RS: 0.016 },
  DBAT54: { IS: 0.1e-6, N: 1.03, RS: 1.5 },
  DZ3V3: { IS: 1e-11, N: 1.5, RS: 2, BV: 3.3 },
  DZ5V1: { IS: 1e-11, N: 1.5, RS: 1, BV: 5.1 },
  DZ9V1: { IS: 1e-11, N: 1.5, RS: 1, BV: 9.1 },
  DZ12V: { IS: 1e-11, N: 1.5, RS: 1, BV: 12 },
  DZ15V: { IS: 1e-11, N: 1.5, RS: 1.5, BV: 15 },
  LED_RED: { IS: 1e-22, N: 1.5, RS: 5 },
  LED_GREEN: { IS: 1e-27, N: 1.6, RS: 5 },
  LED_BLUE: { IS: 1e-30, N: 1.8, RS: 8 },
  LED_YELLOW: { IS: 1e-23, N: 1.55, RS: 5 },
  LED_WHITE: { IS: 1e-30, N: 1.85, RS: 8 },
};

/** Subcircuit hành vi. Mỗi subckt độc lập, thứ tự chân ghi ở dòng .subckt. */
export const SUBCKTS: Record<string, string> = {
  NL_OPAMP: `.subckt NL_OPAMP inp inn out vcc vee GM=1m RG=100meg CP=159p VHI=1.5 VLO=0.02 RO=40 RQ=7k RIN=2meg
Rin inp inn {RIN}
G1 0 n1 inp inn {GM}
R1 n1 0 {RG}
C1 n1 0 {CP}
B2 n2 0 V = max(min(v(n1), v(vcc)-{VHI}), v(vee)+{VLO})
Ro n2 out {RO}
Rq vcc vee {RQ}
.ends`,
  NL_CMP: `.subckt NL_CMP inp inn out vcc gnd
Rin inp inn 10meg
B1 out gnd I = 0.016 * 0.5*(1+tanh((v(inn)-v(inp))*2000)) * tanh(max(v(out,gnd),0)/0.1)
Rq vcc gnd 10k
.ends`,
  NL_555: `.subckt NL_555 gnd trig out reset ctrl thr dis vcc
R1 vcc ctrl 5k
R2 ctrl lo 5k
R3 lo gnd 5k
Bq q gnd V = 0.5*(1+tanh((v(reset,gnd)-0.7)*20)) * (0.5*(1+tanh((v(lo,gnd)-v(trig,gnd))*50)) + (1-0.5*(1+tanh((v(lo,gnd)-v(trig,gnd))*50))) * (1-0.5*(1+tanh((v(thr,gnd)-v(ctrl,gnd))*50))) * 0.5*(1+tanh((v(qd,gnd)-0.5)*12)))
Rd q qd 1k
Cd qd gnd 10p
Bo no gnd V = 0.5*(1+tanh((v(qd,gnd)-0.5)*40)) * max(v(vcc,gnd)-1.7, 0) + 0.05
Ro no out 10
Bdis dis gnd I = 0.5*(1+tanh((0.5-v(qd,gnd))*40)) * v(dis,gnd) / 15
Rq vcc gnd 3k
.ends`,
  NL_VREG: `.subckt NL_VREG in gnd out VOUT=5 DROP=2 IQ=5m
B1 n1 gnd V = min({VOUT}, max(v(in,gnd)-{DROP}, 0))
Vs n1 n2 0
Ro n2 out 0.02
F1 in gnd Vs 1
Bq in gnd I = {IQ}*tanh(max(v(in,gnd),0))
.ends`,
  NL_LM317: `.subckt NL_LM317 in adj out
B1 n1 0 V = v(adj) + min(1.25, max(v(in)-v(adj)-1.75, 0))
Vs n1 n2 0
Ro n2 out 0.01
F1 in 0 Vs 1
Iadj in adj 50u
.ends`,
  NL_RELAY: `.subckt NL_RELAY c1 c2 com no nc RCOIL=70 VON=3.75 VOFF=1.5
Rc c1 cm {RCOIL}
Lc cm c2 50m
S1 com no c1 c2 NL_SWON
S2 com nc c1 c2 NL_SWOFF
.model NL_SWON SW(VT={(VON+VOFF)/2} VH={(VON-VOFF)/2} RON=0.05 ROFF=1e9)
.model NL_SWOFF SW(VT={(VON+VOFF)/2} VH={(VON-VOFF)/2} RON=1e9 ROFF=0.05)
.ends`,
  NL_OPTO: `.subckt NL_OPTO a k c e CTR=1
D1 a ki NL_IRLED
Vs ki k 0
B1 c e I = {CTR} * max(i(Vs), 0) * tanh(max(v(c,e), 0) / 0.15)
Rl c e 1e9
.model NL_IRLED D(IS=1e-18 N=1.6 RS=3)
.ends`,
  NL_NOT: `.subckt NL_NOT a y VDD=5
Ra a 0 10meg
B1 n1 0 V = {VDD} * (1 - 0.5*(1+tanh((v(a)-{VDD}/2)*20)))
Ro n1 y 50
.ends`,
  NL_SCR: `.subckt NL_SCR a k g
Q1 b2 b1 a NL_SCRP
Q2 b1 b2 k NL_SCRN
Rgk b2 k 1k
Rg g b2 10
.model NL_SCRP PNP(IS=1e-14 BF=5 CJE=10p CJC=10p)
.model NL_SCRN NPN(IS=1e-14 BF=100 CJE=10p CJC=10p)
.ends`,
  NL_XTAL: `.subckt NL_XTAL 1 2 RS=20 LS=10m CS=1f CP=5p
Rs 1 n1 {RS}
Ls n1 n2 {LS}
Cs n2 2 {CS}
Cp 1 2 {CP}
.ends`,
  NL_XFMR: `.subckt NL_XFMR p1 p2 s1 s2 LP=10m N=0.5 K=0.99 RW=0.5
Rp p1 pa {RW}
Lp pa p2 {LP}
Rs s1 sa {RW}
Ls sa s2 {LP*N*N}
Kx Lp Ls {K}
.ends`,
};

/** Tham số op-amp theo mã IC (dùng cho NL_OPAMP). */
export const OPAMP_PARAMS: Record<string, { gain: number; gbw: number; vhi: number; vlo: number; ro: number; iq: number; note: string }> = {
  LM358: { gain: 1e5, gbw: 1e6, vhi: 1.5, vlo: 0.02, ro: 40, iq: 0.7e-3, note: 'nguồn đơn, ra sát GND' },
  LM324: { gain: 1e5, gbw: 1.2e6, vhi: 1.5, vlo: 0.02, ro: 40, iq: 0.7e-3, note: '4 kênh, nguồn đơn' },
  LM741: { gain: 2e5, gbw: 1e6, vhi: 1.5, vlo: 1.5, ro: 75, iq: 1.7e-3, note: 'cổ điển, cần nguồn đôi' },
  TL072: { gain: 2e5, gbw: 3e6, vhi: 1.5, vlo: 1.5, ro: 50, iq: 1.4e-3, note: 'đầu vào JFET, âm thanh' },
  NE5532: { gain: 1e5, gbw: 10e6, vhi: 1.2, vlo: 1.2, ro: 30, iq: 4e-3, note: 'nhiễu thấp, âm thanh' },
  MCP6002: { gain: 1e5, gbw: 1e6, vhi: 0.025, vlo: 0.025, ro: 60, iq: 0.1e-3, note: 'rail-to-rail, 1,8–6 V' },
};

/** Ổn áp cố định: điện áp ra và dropout. */
export const VREG_PARAMS: Record<string, { vout: number; drop: number; iq: number }> = {
  '7805': { vout: 5, drop: 2, iq: 5e-3 },
  '7809': { vout: 9, drop: 2, iq: 5e-3 },
  '7812': { vout: 12, drop: 2, iq: 5e-3 },
  '7833': { vout: 3.3, drop: 2, iq: 5e-3 },
  'AMS1117-3.3': { vout: 3.3, drop: 1.1, iq: 5e-3 },
  'AMS1117-5.0': { vout: 5, drop: 1.1, iq: 5e-3 },
};

/** Relay theo điện áp cuộn dây. */
export const RELAY_PARAMS: Record<string, { rcoil: number; von: number; voff: number }> = {
  '5V': { rcoil: 70, von: 3.75, voff: 0.5 },
  '12V': { rcoil: 400, von: 9, voff: 1.2 },
  '24V': { rcoil: 1600, von: 18, voff: 2.4 },
};

export const GATE_FUNCS = ['AND', 'NAND', 'OR', 'NOR', 'XOR', 'XNOR'] as const;

// Cổng logic 2 vào: ngưỡng VDD/2, chuyển mạch mềm (tanh) để ngspice dễ hội tụ.
{
  const A = '0.5*(1+tanh((v(a)-{VDD}/2)*20))', B = '0.5*(1+tanh((v(b)-{VDD}/2)*20))';
  const expr: Record<(typeof GATE_FUNCS)[number], string> = {
    AND: `${A}*${B}`,
    NAND: `1-${A}*${B}`,
    OR: `${A}+${B}-${A}*${B}`,
    NOR: `1-(${A}+${B}-${A}*${B})`,
    XOR: `${A}+${B}-2*${A}*${B}`,
    XNOR: `1-(${A}+${B}-2*${A}*${B})`,
  };
  for (const f of GATE_FUNCS) {
    SUBCKTS[`NL_${f}`] = `.subckt NL_${f} a b y VDD=5
Ra a 0 10meg
Rb b 0 10meg
B1 n1 0 V = {VDD} * (${expr[f]})
Ro n1 y 50
.ends`;
  }
}
