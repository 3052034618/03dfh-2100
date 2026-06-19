const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

router.get('/', notificationController.listNotifications);
router.get('/:id', notificationController.getNotification);
router.post('/:id/read', notificationController.markAsRead);
router.post('/:id/confirm', notificationController.confirmNotification);
router.post('/:id/send', notificationController.sendNow);

module.exports = router;
