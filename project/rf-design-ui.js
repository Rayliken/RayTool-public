/* Small editing controls for physical joins and receiver assumptions. */
function inspectDesignControls() {
  if (!sel) return;
  const n = M.nodes[sel.id],
    e = M.edges[sel.id],
    box = $('#insp');
  if (n) {
    const kind = $('#iKind'),
      oldKind = n.kind,
      base = kind?.onchange;
    if (kind) kind.onchange = ev => {
      const proposed = {
        ...n,
        kind: ev.target.value
      };
      if (edgesAt(n.id).length > RFDesign.capacity(proposed)) {
        ev.target.value = oldKind;
        return msg('Too many connected cables for this kind. Disconnect or insert a rated splitter/coupler first.');
      }
      base(ev);
    };
    const device = $('#iD');
    if (device && n.kind === 'device') {
      const original = device.onchange;
      device.onchange = ev => {
        if (edgesAt(n.id).length > RFDesign.capacity({
            ...n,
            dev: ev.target.value
          })) {
          ev.target.value = n.dev;
          return msg('Disconnect excess cables before reducing component ports.');
        }
        original(ev);
      };
    }
    const conn = $('#iConn');
    if (conn) {
      const fn = conn.onchange;
      conn.onchange = ev => {
        n.connector_count_mode = 'manual';
        fn(ev);
      };
      conn.previousElementSibling.textContent = 'Connectors, excl. adapters';
    }
    if (n.kind === 'junction' && edgesAt(n.id).length > 2) {
      const b = document.createElement('section');
      b.className = 'designWarning';
      b.innerHTML = '<b>Branch needs a passive</b><p>Keep all cables; choose the actual component, then verify its IN / outputs.</p><button id="branchSplitter" class="btn">Insert 2-way splitter</button><button id="branchCoupler" class="btn">Insert 10dB coupler</button>';
      box.prepend(b);
      for (const [id, dev] of [
          ['branchSplitter', 'SPL2'],
          ['branchCoupler', 'DC10']
        ]) $('#' + id).onclick = () => {
        snap();
        RFDesign.convertBranch(M, n.id, dev);
        draw();
      };
    }
    if (n.connection_type === 'ADAPTER') {
      const s = document.createElement('section');
      s.innerHTML = `<b>Inline adapter · 2 cable ends</b><div class="row"><span>Adapter allowance dB</span><input id="adapterLoss" type="number" min="0" step="0.01" value="${n.adapter_loss_db}"></div><p class="hint">v14 estimate: 2 × 0.02dB cable-end connections, separate from the path connector allowance.</p>`;
      box.append(s);
      $('#adapterLoss').onchange = ev => {
        snap();
        n.adapter_loss_db = RFCore.number(ev.target.value);
        draw();
      };
    }
    if (n.kind === 'source') {
      const s = document.createElement('section');
      s.innerHTML = `<div class="row"><span>Power plane</span><select id="sourcePlane"><option value="ORU_BEFORE_POI">Raw ORU, before POI</option><option value="AFTER_POI">After POI</option><option value="INHERITED_AFTER_POI">Inherited output (POI counted upstream)</option><option value="UNSPECIFIED">Unspecified</option></select></div><p class="hint">Raw ORU default 31dBm. POI 1.5dB at 400/850MHz; 0dB at 1950MHz. Inherited power is not reset to 31dBm.</p>`;
      box.append(s);
      $('#sourcePlane').value = n.power_reference_plane || 'UNSPECIFIED';
      $('#sourcePlane').onchange = ev => {
        snap();
        n.power_reference_plane = ev.target.value;
        draw();
      };
    }
  }
  if (n?.kind === 'antenna' || e?.cable === 'LCK') {
    const item = e || n,
      row = RFCore.terminalRows(M).find(r => e ? r.id === e.id : r.node_id === n.id && r.kind === 'Antenna');
    if (!row) return;
    const panel = document.createElement('details');
    panel.className = 'coverageEditor';
    panel.open = true;
    panel.innerHTML = '<summary>Receiver · −85dBm threshold</summary><p class="hint">v14 design distance / penetration; editable per band. Received signal includes FSPL or leaky coupling loss.</p>' + RFCore.FREQ.map(f => {
      const c = RFDesign.coverage(M, row, f),
        r = RFDesign.received(M, row, f);
      return `<section><b>${f}MHz${f===850?' · 800 band':''}</b><div class="row"><span>Range m</span><input data-rx-range="${f}" type="number" min="0.01" step="0.1" value="${c.range_m??''}"></div><div class="row"><span>Penetration dB</span><input data-rx-pen="${f}" type="number" min="0" step="0.1" value="${c.penetration_db??''}"></div><p class="${r.received_dbm!=null&&r.received_dbm<r.threshold_dbm?'rxLow':'hint'}">RX: ${r.received_dbm==null?'Input / design required':r.received_dbm.toFixed(2)+' dBm · margin '+r.margin_db.toFixed(2)+' dB'}</p></section>`;
    }).join('');
    box.append(panel);
    for (const [attr, key] of [
        ['rx-range', 'range_m'],
        ['rx-pen', 'penetration_db']
      ]) panel.querySelectorAll('[data-' + attr + ']').forEach(el => el.onchange = () => {
      snap();
      const f = el.getAttribute('data-' + attr);
      item.coverage ??= {};
      item.coverage.by_frequency ??= {};
      item.coverage.by_frequency[f] = {
        ...RFDesign.coverage(M, row, +f),
        ...item.coverage.by_frequency[f],
        [key]: RFCore.number(el.value),
        basis: 'USER_EDITED_RECEIVER_INPUT'
      };
      draw();
    });
  }
};
