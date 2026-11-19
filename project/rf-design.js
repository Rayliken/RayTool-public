/* Backward-compatible public facade. Calculation and validation belong to RFCore. */
(function(host) {
  'use strict';
  const core = host.RFCore || require('./rf-core.js');
  host.RFDesign = {
    ...core.physical,
    ...core.budget
  };
  if (typeof module !== 'undefined') module.exports = host.RFDesign;
})(typeof globalThis === 'undefined' ? this : globalThis);
