(function(host) {
  "use strict";

  function create(C, physical) {
    const {
      CABLE,
      FREQ,
      THRU,
      GAINS,
      number
    } = C;
    const finite = v => typeof v === "number" && Number.isFinite(v);

    function calculatePath(m, row, freq) {
      const index = FREQ.indexOf(+freq);
      if (index < 0) throw Error("Unsupported frequency");
      const ready = row.status === "PATH_READY" && row.len;
      let cable = null,
        passive = null,
        jumper = null;
      if (ready) {
        cable = Object.entries(row.len).every(([k, v]) =>
            finite(CABLE[k]?.loss[index]),
          ) ?
          Object.entries(row.len).reduce(
            (s, [k, v]) => s + (v * CABLE[k].loss[index]) / 100,
            0,
          ) :
          null;
        passive = 0;
        for (const c of row.components) {
          const custom = c.loss_db?.[freq] ?? c.loss_db?.[String(freq)],
            v = finite(custom) ? custom : custom?.[c.role];
          let loss = v;
          if (loss == null) {
            loss = {
              SPL2: 3.2,
              SPL3: 5.4,
              POI: 1.5
            } [c.dev];
            if (/^DC/.test(c.dev || "")) {
              const db = +c.dev.slice(2);
              loss =
                c.role === "COUPLED" ? db : c.role === "THRU" ? THRU[db] : null;
            }
          }
          if (!finite(loss)) {
            passive = null;
            break;
          }
          passive += loss;
        }
        jumper = row.jumper != null ? (row.jumper / 2) * 0.1 : null;
      }
      const subtotal =
        cable != null && passive != null && jumper != null ?
        cable + passive + jumper :
        null;
      const connector =
        row.connector_count != null ? row.connector_count * 0.02 : null,
        source = number(row.source_power_dbm?.[freq]);
      const total =
        subtotal != null && connector != null ? subtotal + connector : null;
      const terminal = source != null && total != null ? source - total : null,
        gain = GAINS[row.type]?.[index] ?? null;
      return {
        endpoint: row.label,
        source_id: row.source_id,
        source_label: row.source_label,
        frequency_mhz: freq,
        cable_loss_db: cable,
        passive_loss_db: passive,
        jumper_loss_db: jumper,
        subtotal_loss_db: subtotal,
        connector_count: row.connector_count,
        connector_count_estimate: row.connector_count_estimate,
        connector_loss_db: connector,
        path_loss_db: total,
        source_dbm: source,
        terminal_dbm: terminal,
        gain_dbi: gain,
        eirp_dbm: row.kind === "Antenna" && terminal != null && gain != null ?
          terminal + gain :
          null,
        status: !ready ?
          "HOLD" :
          subtotal == null ?
          "LOSS_DATA_REQUIRED" :
          source == null ?
          "SOURCE_POWER_REQUIRED" :
          connector == null ?
          "CONNECTORS_REQUIRED" :
          "CALCULATED_REVIEW",
      };
    }

    const {
      BLOCK
    } = physical;

    function adapters(m, row) {
      const ids = new Set();
      for (const id of row.path_edge_ids || []) {
        const e = m.edges[id];
        if (e) {
          ids.add(e.a);
          ids.add(e.b);
        }
      }
      return [...ids].map(id => m.nodes[id]).filter(n => n?.connection_type === 'ADAPTER');
    }

    function calculate(m, row, freq) {
      const f = +freq,
        source = m.nodes[row.source_id],
        parts = (row.components || []).map(x => x.dev === 'POI' ? {
          ...x,
          loss_db: {
            400: 1.5,
            850: 1.5,
            1950: 0
          }
        } : x);
      const implicit = source?.power_reference_plane === 'ORU_BEFORE_POI' && !parts.some(x => x.dev === 'POI') ? (f === 1950 ? 0 : 1.5) : 0;
      const joins = adapters(m, row),
        adapterLoss = joins.reduce((s, n) => s + C.number(n.adapter_loss_db ?? 0.04), 0);
      const injected = [...parts];
      if (implicit) injected.push({
        dev: 'POI',
        role: 'OUT',
        loss_db: {
          [f]: implicit
        }
      });
      if (adapterLoss) injected.push({
        dev: 'ADAPTER',
        role: 'OUT',
        loss_db: {
          [f]: adapterLoss
        }
      });
      const blocked = (row.issues || []).some(x => BLOCK.has(x.code));
      const result = calculatePath(m, {
        ...row,
        components: injected,
        status: blocked ? 'HOLD' : row.status
      }, f);
      return {
        ...result,
        poi_loss_db: implicit + parts.filter(x => x.dev === 'POI').length * (f === 1950 ? 0 : 1.5),
        adapter_loss_db: adapterLoss,
        adapter_count: joins.length,
        oru_reference_plane: source?.power_reference_plane || 'UNSPECIFIED'
      };
    };

    function reviewCalculation(m, row, f) {
      const bad = (row.issues || []).some(x => BLOCK.has(x.code)) || row.kind === 'Open end';
      const c = calculate(m, {
        ...row,
        status: bad ? 'HOLD' : 'PATH_READY'
      }, f);
      return {
        ...c,
        status: bad ? 'INVALID_DESIGN' : c.subtotal_loss_db == null ? 'INCOMPLETE_REVIEW_INPUTS' : 'PROVISIONAL_REVIEW_ONLY'
      };
    };

    function coverage(m, row, f) {
      const item = row.coverage?.by_frequency?.[f] || row.coverage || {};
      const defaults = m.meta.coverage_defaults?.[row.kind === 'Leaky' ? 'Leaky' : 'Antenna']?.[f] || {};
      const range = C.number(Object.hasOwn(item, 'range_m') ? item.range_m : defaults.range_m),
        penetration = C.number(Object.hasOwn(item, 'penetration_db') ? item.penetration_db : defaults.penetration_db);
      const cl = row.kind === 'Leaky' ? C.number(item.coupling_loss_db ?? ({
        400: 70,
        850: 70,
        1950: 65
      } [f])) : 0;
      return {
        range_m: range,
        penetration_db: penetration,
        coupling_loss_db: cl,
        threshold_dbm: C.number(m.meta.rx_threshold_dbm ?? -85),
        basis: item.basis || defaults.basis || 'INPUT_REQUIRED'
      };
    }

    function received(m, row, f, review = true) {
      const c = review ? C.reviewCalculation(m, row, f) : C.calculate(m, row, f),
        v = coverage(m, row, f);
      const valid = row.kind !== 'Open end' && v.range_m > 0 && v.penetration_db != null && v.coupling_loss_db != null;
      const fspl = valid ? (row.kind === 'Leaky' ? 0 : 32.4 + 20 * Math.log10(f) + 20 * Math.log10(v.range_m / 1000)) : null;
      const correction = valid && row.kind === 'Leaky' ? 10 * Math.log10(v.range_m / 2) : valid ? 0 : null;
      const gain = row.kind === 'Leaky' ? 0 : c.gain_dbi;
      const rx = valid && c.terminal_dbm != null && gain != null ? c.terminal_dbm + gain - v.coupling_loss_db - v.penetration_db - fspl - correction : null;
      return {
        ...c,
        ...v,
        kind: row.kind,
        node_id: row.node_id,
        endpoint_id: row.id,
        gain_dbi: gain,
        fspl_db: fspl,
        leaky_correction_db: correction,
        received_dbm: rx,
        margin_db: rx == null ? null : rx - v.threshold_dbm,
        rx_state: rx == null ? 'INPUT / DESIGN REQUIRED' : rx < v.threshold_dbm ? `LOW < ${v.threshold_dbm} dBm` : 'ABOVE THRESHOLD (REVIEW)'
      };
    }

    function receivedRows(m) {
      return C.terminalRows(m).flatMap(row => C.FREQ.map(f => received(m, row, f)));
    }

    function warnings(m) {
      const out = {};
      for (const r of receivedRows(m))
        if (r.received_dbm != null && r.received_dbm < r.threshold_dbm) {
          const k = r.kind === 'Leaky' ? 'edge:' + r.endpoint_id : 'node:' + r.node_id;
          if (!out[k] || r.received_dbm < out[k].received_dbm) out[k] = r;
        }
      return out;
    }

    return {
      calculate,
      reviewCalculation,
      adapters,
      coverage,
      received,
      receivedRows,
      warnings
    };
  }
  host.RFBudget = {
    create
  };
  if (typeof module !== "undefined") module.exports = host.RFBudget;
})(typeof globalThis === "undefined" ? this : globalThis);
