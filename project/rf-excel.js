function buildWorkbook() {
  const X = window.XLSX;
  const rows = budgetRows(),
    wb = X.utils.book_new(),
    sourceRows = [["Key", "Source ID", "Source name", "MHz", "Power dBm", "Reference plane", "POI at source dB", "After local POI dBm"]];
  for (const n of Object.values(M.nodes).filter((n) => n.kind === "source"))
    for (const f of RFCore.FREQ)
      sourceRows.push([
        n.id + "|" + f,
        n.id,
        n.label || n.id,
        f,
        RFCore.number(n.power_dbm?.[f]),
        n.power_reference_plane||'UNSPECIFIED',
        n.power_reference_plane==='ORU_BEFORE_POI'&&f!==1950?1.5:0,
        RFCore.number(n.power_dbm?.[f])==null?null:RFCore.number(n.power_dbm[f])-(n.power_reference_plane==='ORU_BEFORE_POI'&&f!==1950?1.5:0),
      ]);
  for(let i=1;i<sourceRows.length;i++){
    const r=i+1,value=sourceRows[i][7];sourceRows[i][7]={f:`IF(ISNUMBER(E${r}),E${r}-G${r},"")`,v:value??'',t:typeof value==='number'?'n':'s'};
  }
  if (sourceRows.length === 1) sourceRows.push(["", "", "", null, null]);
  const N = sourceRows.length;
  const cableData = cableTable(),
    cableIndices = {};
  cableData[0].push(
    "400 MHz dB / 100m",
    "850 MHz dB / 100m",
    "1950 MHz dB / 100m",
    "400 MHz loss dB",
    "850 MHz loss dB",
    "1950 MHz loss dB",
  );
  Object.values(M.edges).forEach((edge, index) => {
    const r = index + 2,
      loss = (RFCore.CABLE[edge.cable] || RFCore.CABLE.UNRESOLVED).loss;
    cableIndices[edge.id] = r;
    cableData[index + 1].push(
      ...loss,
      ...loss.map((v, i) => ({
        f: `IF(AND(ISNUMBER(H${r}),H${r}>=0,ISNUMBER(${["P", "Q", "R"][i]}${r}),${["P", "Q", "R"][i]}${r}>=0),H${r}*${["P", "Q", "R"][i]}${r}/100,"")`,
        v:
          v != null && lengthInfo(edge).value != null
            ? (v * lengthInfo(edge).value) / 100
            : "",
        t: v != null && lengthInfo(edge).value != null ? "n" : "s",
      })),
    );
  });
  cableData[0].push('Stair from','Stair to');Object.values(M.edges).forEach((e,i)=>cableData[i+1].push(e.stair?.from||'',e.stair?.to||''));
  const rf = [
    [
      "Source ID",
      "Endpoint",
      "MHz",
      "State",
      "Cable dB",
      "Passive dB",
      "Jumper dB",
      "Subtotal dB",
      "Connector count",
      "Connector dB",
      "Path loss dB",
      "Source dBm",
      "Terminal dBm",
      "Gain dBi",
      "EIRP dBm",
      "Path edges",
      "Review issues",
    ],
  ];
  for (const row of rows)
    for (const f of RFCore.FREQ) {
      const c = RFCore.calculate(M, row, f),
        r = rf.length + 1,
        ix = `INDEX(Sources!$E$2:$E$${N},MATCH(A${r}&"|"&C${r},Sources!$A$2:$A$${N},0))`;
      rf.push([
        row.source_id || "",
        row.label,
        f,
        row.status === "HOLD"
          ? "HOLD - graph / length review"
          : {
              f: `IF(NOT(ISNUMBER(H${r})),"LOSS DATA REQUIRED",IF(NOT(ISNUMBER(J${r})),"CONNECTORS REQUIRED",IF(NOT(ISNUMBER(L${r})),"SOURCE POWER REQUIRED","CALCULATED REVIEW")))`,
            },
        cableFormula(row, f, c.cable_loss_db, cableIndices),
        c.passive_loss_db,
        c.jumper_loss_db,
        { f: `IF(COUNT(E${r}:G${r})=3,SUM(E${r}:G${r}),"")` },
        row.connector_count,
        { f: `IF(ISNUMBER(I${r}),I${r}*0.02,"")` },
        { f: `IF(COUNT(H${r},J${r})=2,H${r}+J${r},"")` },
        { f: `IFERROR(IF(${ix}="","",${ix}),"")` },
        { f: `IF(COUNT(K${r}:L${r})=2,L${r}-K${r},"")` },
        c.gain_dbi,
        row.kind === "Antenna"
          ? { f: `IF(COUNT(M${r}:N${r})=2,SUM(M${r}:N${r}),"")` }
          : null,
        row.path_edge_ids.join(" > "),
        row.issues.map((i) => i.code + ": " + i.item).join("; "),
      ]);
    }
  const provisional = [["Endpoint", "Installation floor", "Serving ORU floor", "Source ID", "MHz", "Input dBm", "Local loss including connectors dB", "Assumed couplers", "Missing lengths", "Provisional terminal dBm", "Gain dBi", "Provisional EIRP dBm", "Status"]];
  for (const row of rows) for (const f of RFCore.FREQ) {
    const r=provisional.length+1,n=M.nodes[row.node_id]||{},c=RFCore.reviewCalculation(M,row,f);
    const blocked=row.issues.some(i=>["PORTS","ENDPOINT","CYCLE","JOINED_SOURCES","NO_SOURCE","TYPE"].includes(i.code));
    const ix=`INDEX(Sources!$E$2:$E$${N},MATCH(D${r}&"|"&E${r},Sources!$A$2:$A$${N},0))`;
    provisional.push([
      row.label,n.installation_floor||"",n.serving_network_floor||"",row.source_id||"",f,
      {f:`IFERROR(IF(${ix}="","",${ix}),"")`},
      blocked||c.subtotal_loss_db==null?null:{f:`IF(COUNT('Provisional path loss'!H${r},'Link Budget'!J${r})=2,SUM('Provisional path loss'!H${r},'Link Budget'!J${r}),"")`},
      row.components.filter(x=>M.nodes[x.node_id]?.device_status==="assumed").length,
      row.segments.filter(x=>x.value==null).length,
      {f:`IF(COUNT(F${r}:G${r})=2,F${r}-G${r},"")`},
      row.kind==="Antenna"?RFCore.GAINS[row.type]?.[RFCore.FREQ.indexOf(f)]??null:null,
      row.kind==="Antenna"?{f:`IF(COUNT(J${r}:K${r})=2,J${r}+K${r},"")`}:null,
      {f:`IF(NOT(ISNUMBER(G${r})),"LOSS / GRAPH DATA REQUIRED",IF(NOT(ISNUMBER(F${r})),"SOURCE POWER REQUIRED","PROVISIONAL REVIEW ONLY"))`}
    ]);
  }
  const rxData=[["Endpoint","Kind","MHz","Feed ID","Input dBm","POI dB (included)","Adapter dB (included)","Terminal dBm","Gain dBi","LCX coupling at 2m dB","Range m","Penetration dB","FSPL dB","LCX range correction dB","Received dBm","Acceptance dBm","Margin dB","Flag","Calculation basis","Serving ORU floor","Coverage evidence","Endpoint key"]];
  for(const row of rows)for(const f of RFCore.FREQ){
    const r=rxData.length+1,c=RFDesign.received(M,row,f),n=M.nodes[row.node_id]||{};
    rxData.push([row.label,row.kind,f,row.source_id||'',
      {f:`IF(ISNUMBER('Provisional RF'!F${r}),'Provisional RF'!F${r},"")`},c.poi_loss_db,c.adapter_loss_db,
      {f:`IF(ISNUMBER('Provisional RF'!J${r}),'Provisional RF'!J${r},"")`},c.gain_dbi,c.coupling_loss_db,c.range_m,c.penetration_db,
      {f:`IF(AND(ISNUMBER(K${r}),K${r}>0),IF(B${r}="Leaky",0,32.4+20*LOG10(C${r})+20*LOG10(K${r}/1000)),"")`},
      {f:`IF(AND(ISNUMBER(K${r}),K${r}>0),IF(B${r}="Leaky",10*LOG10(K${r}/2),0),"")`},
      {f:`IF(COUNT(H${r}:J${r},L${r}:N${r})=6,H${r}+I${r}-J${r}-L${r}-M${r}-N${r},"")`},c.threshold_dbm,
      {f:`IF(ISNUMBER(O${r}),O${r}-P${r},"")`},
      {f:`IF(ISNUMBER(O${r}),IF(O${r}<P${r},"LOW < -85 dBm","ABOVE THRESHOLD (REVIEW)"),"INPUT / DESIGN REQUIRED")`},
      'Provisional v14 design, not a survey or coverage acceptance',n.serving_network_floor||M.nodes[row.source_id]?.equipment_floor||'',c.basis,row.id]);
  }
  for (const [name, data] of [
    ["Received signal",rxData],
    ["Physical joins",[["Node","Adapter ID","Cable 1","Cable 2","Ports","Allowance dB","Basis"],...Object.values(M.nodes).filter(n=>n.connection_type==='ADAPTER').map(n=>{const es=Object.values(M.edges).filter(e=>e.a===n.id||e.b===n.id);return [n.id,n.label||'',es[0]?.label||es[0]?.id||'',es[1]?.label||es[1]?.id||'',2,n.adapter_loss_db,n.adapter_loss_basis]})]],
    ["Provisional RF", provisional],
    ["Endpoint feed", [
      ["Node", "Antenna", "Installation floor", "Serving ORU floor", "Model file floor", "Canonical budget model", "Feed source", "CAD symbol", "Asset ID", "Feed basis"],
      ...Object.values(M.nodes).filter(n=>n.kind==="antenna").map(n=>[
        n.id,n.label,n.installation_floor||"",n.serving_network_floor||"",M.meta.floor,
        n.canonical_budget_model_floor||M.meta.floor,rows.find(r=>r.node_id===n.id)?.source_label||"",
        n.symbol_handle||"",n.physical_asset_id||"",n.feed_basis||M.meta.floor_semantics||""
      ])
    ]],
    ["Name register", [
      ["Edge", "Previous name", "Formal name", "Assignment basis", "Class"],
      ...(M.meta.assigned_name_register||[]).map(x=>[x.edge,x.previous_label,x.new_label,x.basis,x.asset_class||"CABLE"])
    ]],
    ["Stair schedule", [
      ["Edge", "Code H", "Code L", "From", "To", "Selected local m", "Reserve reference m", "Physical run", "Accounting"],
      ...Object.values(M.edges).filter(e=>e.cable==="LCK").map(e=>[
        e.id,...["-H-","-L-"].map(b=>RFCore.labels(M,e).find(x=>x.includes(b))||""),
        e.stair?.from||"",e.stair?.to||"",RFCore.lengthInfo(M,e).value,
        e.reference_reserve_m??(RFCore.lengthInfo(M,e).is_reserve?RFCore.lengthInfo(M,e).value:null),
        e.physical_run_id||e.length?.global_run_id||e.length?.run_id||"",
        e.reserve_accounting||e.length?.reason||""
      ])
    ]],
    ["Layout PDF review", [
      ["Item", "Status", "Detail", "Annotation references", "Green highlight"],
      ...(M.meta.layout_pdf_review||[]).map(x=>[x.item,x.status,x.detail,(x.annotation_indices||[]).join(', '),x.green_highlight?'YES':''])
    ]],
    ["Assumptions", [
      ["Node", "Component", "Coupled dB", "Thru dB", "Value status", "Basis"],
      ...Object.values(M.nodes).filter(n=>n.kind==="device"&&n.device_status==="assumed").map(n=>[
        n.id,n.label,n.assumed_db??null,RFCore.THRU[n.assumed_db]??null,n.device_status,n.value_note||n.value_basis||""
      ])
    ]],
    ["Source mapping", [
      ["Source", "Label", "ORU equipment floor", "Model interface floor", "Upstream model node", "Power status", "Location evidence"],
      ...Object.values(M.nodes).filter(n=>n.kind==="source").map(n=>[
        n.id,n.label,n.equipment_floor||n.source_location_floor||"",
        n.upstream_connection?.model_file_floor||n.upstream_connection?.floor||M.meta.floor,
        n.upstream_connection?.node||"",n.power_basis?.status||n.source_status||"",n.source_location_basis||""
      ])
    ]],
    ["Link Budget", rf],
    ["Sources", sourceRows],
    ["Cable schedule", cableData],
    ["Components", compAOA()],
    ["Checks", window.ProjectChecks ? ProjectChecks.table() : [["Code", "Item", "Action"], ...validateModel()]],
    [
      "Provisional path loss",
      [
        [
          "Endpoint",
          "Source",
          "MHz",
          "State",
          "Cable dB (review)",
          "Passive dB (review)",
          "Jumper dB (review)",
          "Subtotal dB (review)",
        ],
        ...rows.flatMap((r) =>
          RFCore.FREQ.map((f) => {
            const c = RFCore.reviewCalculation(M, r, f);
            return [
              r.label,
              r.source_label,
              f,
              c.status,
              c.cable_loss_db,
              c.passive_loss_db,
              c.jumper_loss_db,
              c.subtotal_loss_db,
            ];
          }),
        ),
      ],
    ],
    [
      "CAD sections",
      [
        [
          "Edge",
          "H/L section IDs",
          "CAD marked m",
          "Label handle",
          "Dimension handle",
        ],
        ...Object.values(M.edges).flatMap((e) =>
          (e.cad_sections || []).map((v) => [
            e.id,
            (v.ids || []).join(" / "),
            v.cad_m,
            v.label_ref,
            v.dimension_ref,
          ]),
        ),
      ],
    ],
    [
      "Reference devices",
      [
        ["Node", "Name", "Device", "Ports", "Evidence"],
        ...Object.values(M.reference_network?.nodes || {})
          .filter((n) => n.kind === "device")
          .map((n) => [
            n.id,
            n.label,
            n.dev,
            JSON.stringify(n.ports || {}),
            JSON.stringify(n.reference || {}),
          ]),
      ],
    ],
    [
      "Calculation basis",
      [
        ["Item", "Basis"],
        [
          "Model",
          "All rows derive from this same loaded JSON; HOLD paths remain listed",
        ],
        [
          "Cable attenuation",
          "v14 coefficients at 400 / 850 / 1950 MHz; verify final manufacturer data",
        ],
        [
          "Length",
          "Selected CAD length; stair reserve defaults to 100m per run; manual overrides retain CAD delta and reason",
        ],
        ["Jumper", "Length in metres; v14 provisional 0.1dB per 2m"],
        [
          "Connector",
          "Enter confirmed path connector count; no default numeric count is inserted",
        ],
        [
          "Source",
          "Edit per-source per-frequency power in Sources. Blank stays blank, never zero.",
        ],
        [
          "Status",
          "Review calculation only; no coverage acceptance is declared",
        ],
      ],
    ],
  ]) {
    const s = X.utils.aoa_to_sheet(data);
    if(name === "Checks" && window.ProjectChecks)for(let i=1;i<data.length;i++){const cell=s["K"+(i+1)];if(cell){cell.l={Target:data[i][10],Tooltip:"開啟 RayTool 並定位"};cell.v="跳轉 Layout";}}
    s["!cols"] = data[0].map((h, i) => ({
      wch: Math.min(
        54,
        Math.max(
          14,
          String(h).length + 2,
          ...data
            .slice(1, 100)
            .map((r) =>
              typeof r[i] === "string" ? Math.min(48, r[i].length) : 12,
            ),
        ),
      ),
    }));
    s["!autofilter"] = { ref: s["!ref"] };
    s["!rows"] = [{ hpt: 26 }];
    X.utils.book_append_sheet(wb, s, name);
  }
  // Cache current calculated values for the preview and readers that do not recalculate Excel.
  const budgetSheet = wb.Sheets["Link Budget"];
  const reviewSheet = wb.Sheets["Provisional RF"];
  const receivedSheet=wb.Sheets["Received signal"];
  let rr = 2;
  for (const row of rows)
    for (const f of RFCore.FREQ) {
      const c = RFCore.calculate(M, row, f);
      const review=RFCore.reviewCalculation(M,row,f);
      const blocked=row.issues.some(i=>["PORTS","ENDPOINT","CYCLE","JOINED_SOURCES","NO_SOURCE","TYPE"].includes(i.code));
      const input=RFCore.number(row.source_power_dbm?.[f]);
      const local=!blocked&&review.subtotal_loss_db!=null&&review.connector_loss_db!=null?review.subtotal_loss_db+review.connector_loss_db:null;
      const terminal=input!=null&&local!=null?input-local:null;
      const eirp=row.kind==="Antenna"&&terminal!=null&&c.gain_dbi!=null?terminal+c.gain_dbi:null;
      const rx=RFDesign.received(M,row,f);
      for(const [key,value]of Object.entries({E:rx.source_dbm,H:rx.terminal_dbm,M:rx.fspl_db,N:rx.leaky_correction_db,O:rx.received_dbm,Q:rx.margin_db,R:rx.rx_state})){
        const cell=receivedSheet[key+rr];if(cell?.f){cell.v=value??'';cell.t=typeof value==='number'?'n':'s';}
      }
      for(const [key,value] of Object.entries({F:input,G:local,J:terminal,L:eirp,M:local==null?"LOSS / GRAPH DATA REQUIRED":input==null?"SOURCE POWER REQUIRED":"PROVISIONAL REVIEW ONLY"})){
        const cell=reviewSheet[key+rr];if(cell?.f){cell.v=value??"";cell.t=typeof value==="number"?"n":"s";}
      }
      for (const [key, value] of Object.entries({
        D: c.status,
        H: c.subtotal_loss_db,
        J: c.connector_loss_db,
        K: c.path_loss_db,
        L: c.source_dbm,
        M: c.terminal_dbm,
        O: row.kind === "Antenna" ? c.eirp_dbm : null,
      })) {
        const cell = budgetSheet[key + rr];
        if (cell?.f) {
          cell.v = value ?? "";
          cell.t = typeof value === "number" ? "n" : "s";
        }
      }
      rr++;
    }
  wb.Workbook ??= {};
  wb.Workbook.CalcPr = { fullCalcOnLoad: true };
  return wb;
}

// Preserve formulas and cached results while adding the v14 magenta fill rule.
function receivedBudgetFormatting(wb) {
  const zip=XLSX.CFB.read(new Uint8Array(XLSX.write(wb,{bookType:"xlsx",type:"array"})),{type:"array"});
  const decoder=new TextDecoder(),encoder=new TextEncoder();
  const get=path=>decoder.decode(zip.FileIndex[zip.FullPaths.findIndex(p=>p.endsWith("/"+path))].content);
  // replace the existing part in place: cfb_add appended a second copy of styles.xml / sheet1.xml, so Excel read the
  // first (unformatted) copy or asked to repair the file, and LibreOffice refused to open it
  const put=(path,xml)=>{const i=zip.FullPaths.findIndex(p=>p.endsWith("/"+path)),bytes=encoder.encode(xml);
    if(i>=0){zip.FileIndex[i].content=bytes;zip.FileIndex[i].size=bytes.length;}else XLSX.CFB.utils.cfb_add(zip,path,bytes);};
  let styles=get("xl/styles.xml");
  const dxf='<dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFF00FF"/><bgColor rgb="FFFF00FF"/></patternFill></fill></dxf>';
  const existing=styles.match(/<dxfs count="(\d+)"/);const id=existing?Number(existing[1]):0;
  if(existing)styles=styles.replace(/<dxfs count="\d+"\s*\/>/,`<dxfs count="${id+1}">${dxf}</dxfs>`).replace(/<dxfs count="\d+">([\s\S]*?)<\/dxfs>/,(_,body)=>`<dxfs count="${id+1}">${body.includes(dxf)?body:body+dxf}</dxfs>`);
  else styles=styles.replace('</styleSheet>',`<dxfs count="1">${dxf}</dxfs></styleSheet>`);
  put("xl/styles.xml",styles);
  const index=wb.SheetNames.indexOf("Received signal")+1;
  if(index>0){const sheet=wb.Sheets["Received signal"],last=XLSX.utils.decode_range(sheet["!ref"]).e.r+1,path=`xl/worksheets/sheet${index}.xml`;
    // received level below the acceptance level (O < P, i.e. −85 dBm) and negative margin (Q): magenta, as v14
    const rule=`<conditionalFormatting sqref="O2:O${last}"><cfRule type="expression" dxfId="${id}" priority="1"><formula>AND(ISNUMBER(O2),O2&lt;$P2)</formula></cfRule></conditionalFormatting>`+
      `<conditionalFormatting sqref="Q2:Q${last}"><cfRule type="expression" dxfId="${id}" priority="2"><formula>AND(ISNUMBER(Q2),Q2&lt;0)</formula></cfRule></conditionalFormatting>`;
    // Excel requires the worksheet children in schema order: conditionalFormatting comes after autoFilter / mergeCells and
    // before dataValidations, hyperlinks, page setup, ignoredErrors … Placed right after </sheetData> (before autoFilter)
    // Excel "repairs" the file and drops the rule, which is why the magenta never showed in Excel.
    const xml=get(path),after=['<dataValidations','<hyperlinks','<printOptions','<pageMargins','<pageSetup','<headerFooter','<rowBreaks','<colBreaks','<customProperties','<cellWatches','<ignoredErrors','<smartTags','<drawing','<legacyDrawing','<picture','<oleObjects','<controls','<webPublishItems','<tableParts','<extLst','</worksheet>'];
    const at=Math.min(...after.map(t=>xml.indexOf(t)).filter(i=>i>=0));
    put(path,xml.slice(0,at)+rule+xml.slice(at));
  }
  return XLSX.CFB.write(zip,{fileType:"zip",type:"array"});
}

function exportWorkbook() {
  const wb = buildWorkbook();
  const bytes = receivedBudgetFormatting(wb);
  dl(new Blob([bytes], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}), fname("Link Budget", "xlsx"));
  msg(
    "Excel saved: current project, editable source power and budget formulas",
  );
}

function cableFormula(row, f, value, indices) {
  if (row.status !== "PATH_READY") return value;
  const col = ["S", "T", "U"][RFCore.FREQ.indexOf(f)],
    refs = row.path_edge_ids.map(
      (id) => `'Cable schedule'!${col}${indices[id]}`,
    );
  if (!refs.length) return 0;
  return {
    f: `IF(COUNT(${refs.join(",")})=${refs.length},SUM(${refs.join(",")}),"")`,
    v: value ?? "",
    t: value == null ? "s" : "n",
  };
}
