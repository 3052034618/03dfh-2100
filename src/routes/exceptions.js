const express = require('express');
const router = express.Router();
const exceptionController = require('../controllers/exceptionController');

router.get('/types', exceptionController.getTypes);
router.post('/', exceptionController.reportException);
router.post('/:id/assign', exceptionController.assignException);
router.get('/:id', exceptionController.getException);
router.post('/:id/handle', exceptionController.handleException);
router.get('/', exceptionController.listExceptions);

module.exports = router;
