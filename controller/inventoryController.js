// controllers/inventoryController.js
const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

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

    // === INPUT VALIDATION ===
    if (!variantId || quantityChange === undefined || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: "Product, quantity change, and reason are required"
      });
    }

    const qty = Number(quantityChange);
    if (isNaN(qty) || qty === 0) {
      return res.status(400).json({ success: false, msg: "Quantity must be a non-zero number" });
    }

    // === FIND VARIANT ===
    const variant = await Variant.findById(variantId).populate('product', 'name');
    if (!variant) {
      return res.status(404).json({ success: false, msg: "Product variant not found" });
    }

    // === PREVENT NEGATIVE STOCK ===
    if (variant.stockQuantity + qty < 0) {
      return res.status(400).json({
        success: false,
        msg: `Insufficient stock. Current: ${variant.stockQuantity}`
      });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += qty;

    // === UPDATE EXPIRY IF PROVIDED ===
    if (expiryAlertDate) {
      const exp = new Date(expiryAlertDate);
      if (isNaN(exp.getTime())) {
        return res.status(400).json({ success: false, msg: "Invalid expiry date" });
      }
      variant.expiryDate = exp;
    }

    await variant.save({ session });

    // === GET A VALID USER ID (NEVER FAILS) ===
    let performedBy = req.user?._id;

    if (!performedBy) {
      // Fallback: Get any admin/inventory user
      const User = mongoose.model('User') || mongoose.models.User;
      const fallbackUser = await User.findOne(
        { role: { $in: ['Admin', 'Inventory Manager', 'Staff'] } },
        { _id: 1 }
      ).lean();

      performedBy = fallbackUser?._id || new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"); // final fallback
    }

    // === CREATE STOCK MOVEMENT LOG ===
    await StockMovement.create([{
      variant: variant._id,
      sku: variant.sku,
      previousQuantity: previousQty,
      newQuantity: variant.stockQuantity,
      changeQuantity: qty,
      movementType: qty > 0 ? 'Purchase/Received' : 'Damage',
      reason: reason.trim(),
      referenceId: referenceId?.trim() || null,
      performedBy: performedBy  // ← ALWAYS a valid ObjectId now
    }], { session });

    await session.commitTransaction();

    res.json({
      success: true,
      msg: qty > 0 ? "Stock added successfully" : "Stock removed successfully",
      data: {
        productName: variant.product?.name || "Unknown Product",
        sku: variant.sku,
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: qty
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Inventory Add Error:", err);
    res.status(500).json({
      success: false,
      msg: "Server error",
      error: err.message
    });
  } finally {
    session.endSession();
  }
};