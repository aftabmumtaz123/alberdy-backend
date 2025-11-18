// controllers/inventoryController.js  ← FINAL SERVERLESS VERSION
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

exports.addInventory = async (req, res) => {
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
    if (isNaN(qty) || qty === 0) {
      return res.status(400).json({ success: false, msg: "Invalid quantity" });
    }

    // === FIND VARIANT ===
    const variant = await Variant.findById(variantId).populate('product', 'name');
    if (!variant) {
      return res.status(404).json({ success: false, msg: "Variant not found" });
    }

    // === PREVENT NEGATIVE STOCK ===
    if (variant.stockQuantity + qty < 0) {
      return res.status(400).json({
        success: false,
        msg: `Insufficient stock: ${variant.stockQuantity}`
      });
    }

    const previousQty = variant.stockQuantity;

    // === UPDATE STOCK & EXPIRY ===
    variant.stockQuantity += qty;

    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (!isNaN(exp.getTime())) {
        variant.expiryDate = exp;
      }
    }

    await variant.save();

    // === GET USER ID (SAFE) ===
    let performedBy = req.user?._id;
    if (!performedBy) {
      const User = mongoose.model('User');
      const fallback = await User.findOne({ role: { $in: ['Admin', 'Inventory Manager'] } }).lean();
      performedBy = fallback?._id || "507f1f77bcf86cd799439011"; // final fallback
    }

    // === CREATE LOG (NO SESSION NEEDED) ===
    await StockMovement.create({
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: qty,
      movementType: qty > 0 ? 'Purchase/Received' : 'Damage',
      reason: reason.trim(),
      referenceId: referenceId?.trim() || null,
      performedBy
    });

    // === SUCCESS ===
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
    console.error("Inventory Error:", err);
    res.status(500).json({
      success: false,
      msg: "Server error",
      error: err.message
    });
  }
};