(function(host) {
  "use strict";

  function create(C) {
    const BLOCK = new Set(['ANTENNA_PORTS', 'BARE_BRANCH', 'SOURCE_BRANCH', 'ADAPTER_REQUIRED', 'PORTS', 'CYCLE', 'JOINED_SOURCES', 'NO_SOURCE', 'ENDPOINT', 'TYPE']);
    const at = (m, id) => Object.values(m.edges).filter(e => e.a === id || e.b === id);

    function capacity(n) {
      if (n.kind === 'antenna' || n.kind === 'termination' || n.kind === 'source') return 1;
      if (n.kind === 'junction') return 2;
      return /^DC/.test(n.dev || '') ? 3 : ({
        SPL2: 3,
        SPL3: 4,
        POI: 2
      } [n.dev] || 0);
    }

    function assertRoom(m, n, exclude = null, adding = 1) {
      if (at(m, n.id).filter(e => e.id !== exclude).length + adding > capacity(n))
        throw Error(n.kind === 'antenna' ? 'Antenna has one IN only. Disconnect its current cable first.' : n.kind === 'junction' ? 'A cable join has two ends only. Insert a coupler or splitter to branch.' : n.kind === 'source' ? 'One ORU output cannot branch directly. Add a splitter or coupler.' : 'All rated component ports are occupied.');
    }

    function markAdapter(m, n) {
      const es = at(m, n.id);
      if (n.kind !== 'junction') {
        delete n.connection_type;
        return;
      }
      if (n.kind === 'junction' && es.length === 2 && !es.some(e => e.diagram_only || e.handoff_reference)) {
        n.connection_type = 'ADAPTER';
        n.adapter_loss_db ??= 0.04;
        n.adapter_loss_basis ??= 'v14 connector estimate: two cable-end connections at 0.02dB each; editable adapter allowance, not a datasheet measurement';
        if (!n.label) {
          const prefix = `PRJ-RS-${m.meta.floor||'L1'}-ADP-`;
          let i = 1;
          const used = new Set(Object.values(m.nodes).map(x => x.label));
          while (used.has(prefix + String(i).padStart(3, '0'))) i++;
          n.label = prefix + String(i).padStart(3, '0');
          n.generated_adapter_label = true;
        }
      } else if (n.kind === 'junction' && es.length < 2 && n.connection_type === 'ADAPTER') {
        delete n.connection_type;
        if (n.generated_adapter_label) {
          delete n.label;
          delete n.generated_adapter_label;
        }
      }
    }

    function normalize(m) {
      for (const n of Object.values(m.nodes)) markAdapter(m, n);
      return m;
    }

    function designIssues(m) {
      const rows = [],
        analysis = C.analyze(m),
        adjacency = new Map();
      for (const e of Object.values(m.edges))
        for (const id of [e.a, e.b]) {
          if (!adjacency.has(id)) adjacency.set(id, []);
          adjacency.get(id).push(e);
        }
      for (const n of Object.values(m.nodes)) {
        const es = adjacency.get(n.id) || [],
          add = (code, message) => rows.push({
            code,
            item: n.id,
            message,
            component: analysis.nodeComponent[n.id]?.id
          });
        if (n.kind === 'antenna' && es.length > 1) add('ANTENNA_PORTS', 'Antenna has one IN; it cannot join or branch cables.');
        if (n.kind === 'junction' && es.length > 2) add('BARE_BRANCH', 'Branch requires a coupler or splitter. Existing wiring retained for repair.');
        if (n.kind === 'source' && es.length > 1) add('SOURCE_BRANCH', 'ORU output requires a coupler or splitter before branching.');
        if (n.kind === 'junction' && es.length === 2 && !es.some(e => e.diagram_only || e.handoff_reference) && n.connection_type !== 'ADAPTER') add('ADAPTER_REQUIRED', 'Two separate cables need an inline adapter.');
      }
      return rows;
    }

    function convertBranch(m, id, dev) {
      if (!['SPL2', 'DC10'].includes(dev)) throw Error('Choose a two-way splitter or 10dB coupler.');
      const n = m.nodes[id],
        es = at(m, id);
      if (!n || n.kind !== 'junction' || es.length !== 3) throw Error('Select an existing three-cable junction.');
      const a = C.analyze(m),
        up = a.pe[id]?.id;
      if (!up) throw Error('Resolve the upstream feed before assigning component ports.');
      Object.assign(n, {
        kind: 'device',
        dev,
        device_status: 'candidate',
        ports: {},
        port_slots: {}
      });
      delete n.connection_type;
      n.label = C.nextDevice(m, dev);
      let i = 1;
      for (const e of es) {
        const role = e.id === up ? 'IN' : dev === 'SPL2' ? 'OUT' : i === 1 ? 'THRU' : 'COUPLED';
        n.ports[e.id] = role;
        n.port_slots[e.id] = role === 'OUT' ? 'OUT' + i++ : role;
        if (role === 'THRU') i++;
      }
      return n;
    }

    return {
      capacity,
      assertRoom,
      markAdapter,
      normalize,
      designIssues,
      convertBranch,
      BLOCK
    };
  }
  host.RFPhysical = {
    create
  };
  if (typeof module !== "undefined") module.exports = host.RFPhysical;
})(typeof globalThis === "undefined" ? this : globalThis);
