const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SmtpConfig = require('../model/SmtpConfig');
const authMiddleware = require('../middleware/auth');
const AppConfiguration = require('../model/app_configuration')

const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// CREATE SMTP Config
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { name, host, port, encryption, username, password, fromEmail, fromName, status = 'active' } = req.body;

    // Validation
    if (!name || !host || !port || !encryption || !username || !password || !fromEmail || !fromName) {
      return res.status(400).json({ success: false, msg: 'All fields are required' });
    }

    const smtpConfig = new SmtpConfig({
      name,
      host,
      port,
      encryption,
      username,
      password,
      fromEmail,
      fromName,
      status
    });

    await smtpConfig.save();

    res.status(201).json({
      success: true,
      data: smtpConfig,
      msg: 'SMTP Config created successfully'
    });
  } catch (err) {
    console.error('SMTP creation error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Duplicate SMTP name' });
    }
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

// GET ALL SMTP Configs
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = status ? { status } : {};
    const configs = await SmtpConfig.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await SmtpConfig.countDocuments(query);

    res.json({
      success: true,
      data: configs,
      pagination: { current: +page, pages: Math.ceil(total / limit), total }
    });
  } catch (err) {
    console.error('SMTP fetch error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

// GET ONE SMTP Config
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid ID' });
    }

    const config = await SmtpConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ success: false, msg: 'SMTP Config not found' });
    }

    res.json({ success: true, data: config });
  } catch (err) {
    console.error('SMTP fetch error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

// UPDATE SMTP Config
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid ID' });
    }

    const updateData = req.body;
    const config = await SmtpConfig.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!config) {
      return res.status(404).json({ success: false, msg: 'SMTP Config not found' });
    }

    res.json({ success: true, data: config, msg: 'SMTP Config updated successfully' });
  } catch (err) {
    console.error('SMTP update error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

// DELETE SMTP Config
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid ID' });
    }

    const config = await SmtpConfig.findByIdAndDelete(req.params.id);
    if (!config) {
      return res.status(404).json({ success: false, msg: 'SMTP Config not found' });
    }

    res.json({ success: true, msg: 'SMTP Config deleted successfully' });
  } catch (err) {
    console.error('SMTP delete error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});


module.exports = router;