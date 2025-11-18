// controllers/inventoryController.js
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

// Helper: Get a valid user ID (never crashes)
const getPerformedBy = async (req) => {
  if (req.user?._id) return req.user._id;

  // Fallback 1: Try to find admin user
  const User = mongoose.model('User');
  const admin = await User.findOne({ role: { $in: ['Admin', 'Inventory Manager'] } });
  if (admin) return admin._id;

  return null; 
};

exports.addInventory = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      variantId,
      quantityChange,
      reason,
      referenceId,
      expiryAlertDate
    } = req.body;

    // === VALIDATION ===
    if (!variantId || quantityChange === undefined || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: "Product, quantity change, and reason are required"
      });
    }

    const qty = Number(quantityChange);
    if (isNaN(quantityChange) || qty === 0) {
      return res.status(400).json({ success: false, msg: "Quantity must be a non-zero number" });
    }

    const variant = await Variant.findById(variantId).populate('product', 'name');
    if (!variant) {
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    // Prevent negative stock
    if (variant.stockQuantity + qty < 0) {
      return res.status19(400).json({
        success: false,
        msg: `Cannot go below zero. Current stock: ${variant.stockQuantity}`
      });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += qty;

    // Update expiry if provided
    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (isNaN(exp.getTime())) {
        return res.status(400).json({ success: false, msg: "Invalid expiry date" });
      }
      variant.expiryDate = exp;
    }

    await variant.save({ session });

    // === CREATE AUDIT LOG (SAFE USER ID) ===
    const performedBy = await getPerformedBy(req);

    await new StockMovement({
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: qty,
      movementType: qty > 0 ? 'Purchase/Received' : 'Damage',
      reason: reason.trim(),
      referenceId: referenceId?.trim() || null,
      performedBy,
      expiryAlertDate: expiryAlertDate ? new Date(expiryAlertDate) : undefined
    }).save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      msg: qty > 0 ? "Stock added successfully" : "Stock removed successfully",
      data: {
        productName: variant.product?.name || "Unknown",
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: qty
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Inventory Error:", err);
    res.status(500).json({
      success: false,
      msg: "Server error",
      error: err.message
    });
  } finally {
    session.endSession();
  }
};