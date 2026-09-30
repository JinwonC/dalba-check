import { loadRates } from '../lib/rates.js';

export default async function handler(req, res) {
  try {
    const data = await loadRates({ refresh: req.query?.refresh === '1' });
    res.status(200).json(data);
  } catch (err) {
    console.error('Rates failed:', err);
    res.status(502).json({ error: err.message || 'Rates failed.' });
  }
}
