const Unit = require('../model/Unit'); // Adjust the path as per your project structure

// Unit Controller for Admin CRUD Operations

// Get all units
exports.getAllUnits = async (req, res) => {
  try {
    const { page = 1, limit = 10, unit_status } = req.query;
    const query = unit_status ? { unit_status } : {};
    const units = await Unit.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    const total = await Unit.countDocuments(query);
    res.json({
      success: true,
      message: 'Units fetched successfully',
      units,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Get unit by ID
exports.getUnitById = async (req, res) => {
  try {
    const unit = await Unit.findById(req.params.id);
    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }
    res.json({
        success: true,
        message: 'Unit fetched successfully',
        data: unit
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Create new unit
exports.createUnit = async (req, res) => {
  try {
    const { parent_name, unit_name, short_name, unit_status } = req.body;

    const check_unit = await Unit.findOne({ unit_name: unit_name });
    if (check_unit) {
      return res.status(400).json({ success: false, message: 'Unit name already exists' });
    }

    if(!short_name || !unit_name) {
      return res.status(400).json({ success: false, message: 'All fields are required especially short name' });
    }

    const check_short_name = await Unit.findOne({ short_name: short_name });
    if(check_short_name) {
      return res.status(400).json({ success: false, message: 'Short name already exists' });
    }

    const unit = new Unit({
      parent_name,
      unit_name,
      short_name,
      unit_status: unit_status || 'enable'
    });
    await unit.save();
    res.status(201).json({
        success: true,
        message: 'Unit created successfully',
        data: unit
    });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Error creating unit', error: err.message });
  }
};

// Update unit
exports.updateUnit = async (req, res) => {
  try {
    const unit = await Unit.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }
    res.json({
        success: true,
        message: 'Unit updated successfully',
        data: unit
    });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Error updating unit', error: err.message });
  }
};

// Delete unit
exports.deleteUnit = async (req, res) => {
  try {
    const unit = await Unit.findByIdAndDelete(req.params.id);
    if (!unit) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }
    res.json({ success: true, message: 'Unit deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error deleting unit', error: err.message });
  }
};