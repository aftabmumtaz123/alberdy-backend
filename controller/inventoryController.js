// controllers/inventoryController.js (NEW VERSION – UI MATCHED)

const Variant = require('../model/variantProduct');
const StockMovement = require('../model/StockMovement');
const mongoose = require('mongoose');

const createMovementLog = async (variant, change, reason, referenceId, user, expiryAlert = null) => {
  await new StockMovement({
    variant: variant._id,
    sku: variant.sku,
    previousQuantity: variant.stockQuantity - change,
    newQuantity: variant.stockQuantity,
    changeQuantity: change,
    movementType: change > 0 ? 'Purchase/Received' : change < 0 ? 'Damage' : 'Adjustment',
    reason: reason.trim(),
    referenceId: referenceId?.trim() || null,
    performedBy: user._id || user,
    expiryAlertDate: expiryAlert || undefined,
  }).save();
};

exports.addInventory = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      variantId,           // from dropdown (variant _id)
      quantityChange,      // positive = add, negative = remove
      reason,
      referenceId,
      expiryAlertDate      // "2025-11-18" from date picker
    } = req.body;

    const user = req.user;

    // Validation
    if (!variantId || quantityChange === undefined || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: "Product, quantity change, and reason are required"
      });
    }

    const qty = Number(quantityChange);
    if (isNaN(qty)) {
      return res.status(400).json({ success: false, msg: "Invalid quantity" });
    }

    const variant = await Variant.findById(variantId);
    if (!variant) {
      return res.status(404).json({ success: false, msg: "Product variant not found" });
    }

    // Prevent negative stock if going below zero
    if (variant.stockQuantity + qty < 0) {
      return res.status(400).json({
        success: false,
        msg: `Cannot reduce stock below zero. Current: ${variant.stockQuantity}`
      });
    }

    const previousQty = variant.stockQuantity;
    variant.stockQuantity += qty;

    // Optional: Update expiry alert
    if (expiryAlertDate) {
      const alertDate = new Date(expiryAlertDate);
      if (isNaN(alertDate.getTime())) {
        return res.status(400).json({ success: false, msg: "Invalid expiry alert date" });
      }
      variant.expiryDate = alertDate;
    }

    await variant.save({ session });

    await createMovementLog(
      variant,
      qty,
      reason,
      referenceId,
      user,
      expiryAlertDate ? new Date(expiryAlertDate) : null
    );

    await session.commitTransaction();

    res.json({
      success: true,
      msg: qty > 0 ? "Stock added successfully" : qty < 0 ? "Stock removed successfully" : "Stock adjusted",
      data: {
        sku: variant.sku,
        productName: (await require('../model/Product').findById(variant.product))?.name || "Unknown",
        previousQuantity: previousQty,
        newQuantity: variant.stockQuantity,
        change: qty,
        movementType: qty > 0 ? "Purchase/Received" : qty < 0 ? "Damage" : "Adjustment"
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Inventory Add Error:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to update inventory",
      error: err.message
    });
  } finally {
    session.endSession();
  }
};