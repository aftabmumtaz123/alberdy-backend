// controllers/inventoryController.js
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

// Helper: Create movement log (read-only)
const createStockMovementLog = async (variant, change, type, reason, referenceId = null, user) => {
  const log = new StockMovement({
    variant: Variant._id,
    sku: variant.sku,
    previousQuantity: variant.stockQuantity - change,
    newQuantity: variant.stockQuantity,
    changeQuantity: change,
    movementType: type,
    reason,
    referenceId,
    performedBy: user._id || user,
  });
  await log.save();
};

const isInventoryManager = (user) => {
  return user && user.role === 'Inventory Manager' || user.role === 'Super Admin';
};

// 1. Receive Stock (Purchase/Received)
exports.receiveStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sku, quantity, reason, referenceId, cost } = req.body;
    const user = req.user; // assume authenticated

    if (!sku || !quantity || quantity <= 0 || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: 'SKU, positive quantity, and reason are required',
      });
    }

    const variant = await Variant.findOne({ sku: sku.trim().toUpperCase() });
    if (!variant) {
      return res.status(404).json({ success: false, msg: 'Variant not found' });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += Number(quantity);
    if (cost !== undefined) variant.purchasePrice = Number(cost);

    await variant.save({ session });

    await createStockMovementLog(
      variant,
      Number(quantity),
      'Purchase/Received',
      reason.trim(),
      referenceId?.trim() || null,
      user
    );

    await session.commitTransaction();
    res.json({
      success: true,
      msg: 'Stock received successfully',
      data: {
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: Number(quantity),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      msg: 'Failed to receive stock',
      error: err.message,
    });
  } finally {
    session.endSession();
  }
};

// 2. Manual Stock Out (Damage, Wastage, Lost, Expired)
exports.reduceStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sku, quantity, reason, referenceId } = req.body;
    const user = req.user;

    if (!sku || !quantity || quantity <= 0 || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: 'SKU, positive quantity, and reason are required',
      });
    }

    const variant = await Variant.findOne({ sku: sku.trim().toUpperCase() });
    if (!variant) {
      return res.status(404).json({ success: false, msg: 'Variant not found' });
    }

    if (variant.stockQuantity < quantity) {
      return res.status(400).json({
        success: false,
        msg: `Insufficient stock. Available: ${variant.stockQuantity}`,
      });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity -= Number(quantity);

    await variant.save({ session });

    await createStockMovementLog(
      variant,
      -Number(quantity),
      'Damage',
      reason.trim(),
      referenceId?.trim() || null,
      user
    );

    await session.commitTransaction();
    res.json({
      success: true,
      msg: 'Stock reduced successfully',
      data: {
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: -Number(quantity),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      msg: 'Failed to reduce stock',
      error: err.message,
    });
  } finally {
    session.endSession();
  }
};

// 3. Stock Adjustment (Only Inventory Manager)
exports.adjustStock = async (req, res) => {
  if (!isInventoryManager(req.user)) {
    return res.status(403).json({ success: false, msg: 'Access denied. Inventory Manager only.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sku, newQuantity, reason, referenceId } = req.body;
    const user = req.user;

    if (!sku || newQuantity === undefined || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: 'SKU, newQuantity, and reason are required',
      });
    }

    if (newQuantity < 0) {
      return res.status(400).json({
        success: false,
        msg: 'New quantity cannot be negative',
      });
    }

    const variant = await Variant.findOne({ sku: sku.trim().toUpperCase() });
    if (!variant) {
      return res.status(404).json({ success: false, msg: 'Variant not found' });
    }

    const change = newQuantity - variant.stockQuantity;
    const previousQty = variant.stockQuantity;

    variant.stockQuantity = Number(newQuantity);
    await variant.save({ session });

    await createStockMovementLog(
      variant,
      change,
      'Adjustment',
      reason.trim(),
      referenceId?.trim() || null,
      user
    );

    await session.commitTransaction();
    res.json({
      success: true,
      msg: 'Stock adjusted successfully',
      data: {
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      msg: 'Adjustment failed',
      error: err.message,
    });
  } finally {
    session.endSession();
  }
};

// 4. Get Stock Movement History (Read-only Log)
exports.getStockMovementHistory = async (req, res) => {
  try {
    const { sku, variantId, page = 1, limit = 20, type } = req.query;

    const filter = {};
    if (sku) filter.sku = sku.trim().toUpperCase();
    if (variantId) filter.variant = variantId;
    if (type) filter.movementType = type;

    const movements = await StockMovement.find(filter)
      .populate('performedBy', 'name email')
      .populate('variant', 'sku product')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await StockMovement.countDocuments(filter);

    // Populate product name
    const populated = await Promise.all(
      movements.map(async (m) => {
        if (m.variant && m.variant.product) {
          const product = await require('../model/Product').findById(m.variant.product).select('name');
          m = m.toObject();
          m.productName = product?.name || 'Unknown';
        }
        return m;
      })
    );

    res.json({
      success: true,
      data: populated,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      msg: 'Failed to fetch history',
      error: err.message,
    });
  }
};

// 5. Get Current Stock Level by SKU
exports.getStockLevel = async (req, res) => {
  try {
    const { sku } = req.params;
    const variant = await Variant.findOne({ sku: sku.trim().toUpperCase() })
      .populate('product', 'name')
      .populate('unit', 'unit_name');

    if (!variant) {
      return res.status(404).json({ success: false, msg: 'SKU not found' });
    }

    res.json({
      success: true,
      data: {
        sku: variant.sku,
        product: variant.product?.name,
        attribute: variant.attribute,
        value: variant.value,
        unit: variant.unit?.unit_name,
        stockQuantity: variant.stockQuantity,
        reservedQuantity: variant.reservedQuantity,
        availableStock: variant.availableStock,
        status: variant.status,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
};