const express = require('express');
const router = express.Router();
const storeConfigController = require('../controllers/storeConfigController');

router.get('/channels', storeConfigController.channelTypes);
router.get('/:key/weekly-trend', storeConfigController.weeklyTrend);
router.get('/:key/daily-report', storeConfigController.dailyReport);
router.get('/:key/dashboard', storeConfigController.dashboard);
router.get('/:key/preview', storeConfigController.previewChannelForRole);
router.post('/', storeConfigController.create);
router.put('/:key', storeConfigController.update);
router.delete('/:key', storeConfigController.delete);
router.get('/:key', storeConfigController.get);
router.get('/', storeConfigController.list);

module.exports = router;
