const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

router.post('/', orderController.createOrder);
router.get('/:id/timeline', orderController.getOrderTimeline);
router.get('/:id', orderController.getOrder);
router.put('/:id', orderController.updateOrder);
router.delete('/:id', orderController.deleteOrder);
router.get('/', orderController.listOrders);
router.post('/:id/confirm', orderController.confirmItem);

module.exports = router;
