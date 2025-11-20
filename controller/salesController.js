const Sale = require('../model/Sales');
const Variant = require('../model/variantProduct');
const User = require('../model/User');
const mongoose = require('mongoose');

exports.createSale = async (req, res) => {
  try {
    const { date, customerId, products, summary, payment, notes, status } = req.body;

    // Validate required fields
    if (!customerId || !products || !summary) {
      return res.status(400).json({ status: false, message: 'Customer ID, products, and summary are required' });
    }

    // Validate summary fields
    const { otherCharges = 0, discount = 0 } = summary;
    if (typeof otherCharges !== 'number' || otherCharges < 0) {
      return res.status(400).json({ status: false, message: 'otherCharges must be a non-negative number' });
    }
    if (typeof discount !== 'number' || discount < 0) {
      return res.status(400).json({ status: false, message: 'discount must be a non-negative number' });
    }

    // Validate customer
    const customer = await User.findById(customerId);
    if (!customer) return res.status(400).json({ status: false, message: 'Invalid customer' });

    // Validate products
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ status: false, message: 'Products array is required and cannot be empty' });
    }

    let subTotal = 0;
    let totalQuantity = 0;
    let taxTotal = 0;
    const validatedProducts = [];
    for (let prod of products) {
      if (!prod.variantId || !prod.quantity || !prod.price || !prod.unitCost) {
        return res.status(400).json({ status: false, message: 'Each product must have variantId, quantity, price, and unitCost' });
      }
      if (prod.quantity < 1 || prod.price < 0 || prod.unitCost < 0 || (prod.taxPercent && prod.taxPercent < 0)) {
        return res.status(400).json({ status: false, message: 'Quantity, price, unitCost, and taxPercent must be valid' });
      }
      if (prod.taxType && !['Inclusive', 'Exclusive'].includes(prod.taxType)) {
        return res.status(400).json({ status: false, message: 'taxType must be Inclusive or Exclusive' });
      }
      const variant = await Variant.findById(prod.variantId);
      if (!variant || variant.status === 'Inactive') {
        return res.status(400).json({ status: false, message: `Invalid or inactive variant: ${prod.variantId}` });
      }
      if (variant.stockQuantity < prod.quantity) {
        return res.status(400).json({ status: false, message: `Insufficient stock for variant ${prod.variantId}` });
      }
      const taxAmount = (prod.price * prod.quantity * (prod.taxPercent || 0)) / 100 * (prod.taxType === 'Exclusive' ? 1 : 0);
      const productTotal = prod.price * prod.quantity + taxAmount;
      subTotal += productTotal;
      taxTotal += taxAmount;
      totalQuantity += prod.quantity;
      validatedProducts.push({ 
        variantId: prod.variantId, 
        quantity: prod.quantity, 
        price: prod.price, 
        taxPercent: prod.taxPercent || 0, 
        taxType: prod.taxType || 'Exclusive', 
        unitCost: prod.unitCost 
      });
    }

    // Validate summary calculations
    const grandTotal = subTotal + otherCharges - discount;
    if (grandTotal < 0) return res.status(400).json({ status: false, message: 'Grand total cannot be negative' });

    // Validate payment
    if (payment) {
      if (typeof payment.amountPaid !== 'number' || payment.amountPaid < 0) {
        return res.status(400).json({ status: false, message: 'payment.amountPaid must be a non-negative number' });
      }
      if (payment.type && !['Cash', 'Card', 'Online', 'BankTransfer'].includes(payment.type)) {
        return res.status(400).json({ status: false, message: 'Invalid payment type' });
      }
    }

    const amountPaid = payment?.amountPaid || 0;
    const amountDue = grandTotal - amountPaid;
    if (amountDue < 0) {
      return res.status(400).json({ status: false, message: 'Amount paid cannot exceed grand total' });
    }

    // Generate unique saleCode
    let saleCode = `SALE-000001`;
    let existing = await Sale.findOne().sort({ saleCode: -1 });
    if (existing) {
      let num = parseInt(existing.saleCode.split('-')[1]) + 1;
      saleCode = `SALE-${String(num).padStart(6, '0')}`;
    }
    while (await Sale.findOne({ saleCode })) {
      let num = parseInt(saleCode.split('-')[1]) + 1;
      saleCode = `SALE-${String(num).padStart(6, '0')}`;
    }


    let finalStatus = status;
    if(!finalStatus){
      finalStatus = amountPaid >= grandTotal ? 'Completed' : 'Pending';
    }

    // Create sale
    const sale = new Sale({
      saleCode,
      date: date && new Date(date) <= new Date() ? date : Date.now(),
      customerId,
      products: validatedProducts,
      status,
      payment: { 
        type: payment?.type || null, 
        amountPaid, 
        amountDue, 
        notes: payment?.notes || '' 
      },
      summary: { 
        totalQuantity, 
        subTotal, 
        taxTotal,
        discount, 
        otherCharges, 
        grandTotal 
      },
      notes: notes || '',
    });

    await sale.save();

    // Update inventory (skip if Cancelled)
    if (status !== 'Cancelled') {
      for (let prod of validatedProducts) {
        await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
      }
    }

    // Populate response
    const populatedSale = await Sale.findById(sale._id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' }
        ],
      });

    res.status(201).json({ 
      status: true, 
      message: 'Sale created successfully', 
      data: {
        _id: populatedSale._id,
        saleCode: populatedSale.saleCode,
        date: populatedSale.date,
        status: populatedSale.status,
        notes: populatedSale.notes,
        customer: {
          id: populatedSale.customerId?._id,
          name: populatedSale.customerId?.name || 'Walk-in Customer',
          email: populatedSale.customerId?.email || '',
          phone: populatedSale.customerId?.phone || '',
        },
        products: populatedSale.products.map((product) => {
          const variant = product.variantId;
          const taxAmount = (product.price * product.quantity * (product.taxPercent || 0)) / 100 
                          * (product.taxType === 'Exclusive' ? 1 : 0);
          return {
            variantId: variant?._id,
            productName: variant?.product?.name || 'Unknown',
            sku: variant?.sku || '',
            attribute: variant?.attribute || '',
            value: variant?.value || '',
            weightQuantity: variant?.weightQuantity || '',
            unit: variant?.unit?.name || 'Unknown',
            unitSymbol: variant?.unit?.symbol || '',
            image: variant?.product?.thumbnail || variant?.image || '',
            quantity: product.quantity,
            price: parseFloat(product.price.toFixed(2)),
            unitCost: parseFloat(product.unitCost.toFixed(2)),
            taxPercent: product.taxPercent || 0,
            taxType: product.taxType || 'Exclusive',
            taxAmount: parseFloat(taxAmount.toFixed(2)),
            total: parseFloat((product.price * product.quantity + taxAmount).toFixed(2)),
          };
        }),
        summary: {
          totalQuantity: populatedSale.summary.totalQuantity,
          subTotal: parseFloat(populatedSale.summary.subTotal.toFixed(2)),
          taxTotal: parseFloat(populatedSale.summary.taxTotal.toFixed(2)),
          discount: parseFloat(populatedSale.summary.discount.toFixed(2)),
          otherCharges: parseFloat(populatedSale.summary.otherCharges.toFixed(2)),
          grandTotal: parseFloat(populatedSale.summary.grandTotal.toFixed(2)),
        },
        payment: {
          type: populatedSale.payment.type || null,
          amountPaid: parseFloat(populatedSale.payment.amountPaid.toFixed(2)),
          amountDue: parseFloat(populatedSale.payment.amountDue.toFixed(2)),
          notes: populatedSale.payment.notes || '',
        },
        createdAt: populatedSale.createdAt,
        updatedAt: populatedSale.updatedAt,
      }
    });
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.getAllSales = async (req, res) => {
  try {
    const { page = 1, limit , startDate, endDate, paymentStatus, search } = req.query;
    const skip = (page - 1) * limit;

    let query = { isDeleted: false };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (paymentStatus) {
      query = {
        ...query,
        $expr: {
          [paymentStatus === 'Paid' ? '$gte' : '$lt']: [
            '$payment.amountPaid',
            '$summary.grandTotal',
          ],
        },
      };
    }
    if (search) {
      const user = await User.findOne({ name: { $regex: search, $options: 'i' } });
      query.$or = [{ saleCode: { $regex: search, $options: 'i' } }];
      if (user) {
        query.$or.push({ customerId: user._id });
      }
    }

    const sales = await Sale.find(query)
      .sort({ createdAt: -1 }) // Recent sales first
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' } // Consistent with create/update
        ],
      })
      .lean();

    const total = await Sale.countDocuments(query);

    res.status(200).json({
      status: true,
      message: 'Sales fetched successfully',
      data: sales.map((sale) => {
        const totalTax = sale.products.reduce((sum, p) => {
          const tax = (p.price * p.quantity * (p.taxPercent || 0)) / 100 * (p.taxType === 'Exclusive' ? 1 : 0);
          return sum + tax;
        }, 0);

        return {
          id: sale._id,
          saleCode: sale.saleCode,
          date: sale.date,
          status: sale.status,
          customer: {
            id: sale.customerId?._id,
            name: sale.customerId?.name || 'Walk-in Customer',
            email: sale.customerId?.email || '',
            phone: sale.customerId?.phone || '',
          },
          summary: {
            totalQuantity: sale.summary.totalQuantity,
            subTotal: parseFloat(sale.summary.subTotal.toFixed(2)),
            taxTotal: parseFloat((sale.summary.taxTotal || totalTax).toFixed(2)),
            discount: parseFloat(sale.summary.discount.toFixed(2)),
            otherCharges: parseFloat(sale.summary.otherCharges.toFixed(2)),
            grandTotal: parseFloat(sale.summary.grandTotal.toFixed(2)),
          },
          payment: {
            type: sale.payment.type || null,
            amountPaid: parseFloat(sale.payment.amountPaid.toFixed(2)),
            amountDue: parseFloat(sale.payment.amountDue.toFixed(2)),
            notes: sale.payment.notes || '',
          },
          paymentStatus: sale.payment.amountPaid >= sale.summary.grandTotal ? 'Paid' : 'Pending',
          products: sale.products.map((product) => {
            const taxAmount = (product.price * product.quantity * (product.taxPercent || 0)) / 100 
                            * (product.taxType === 'Exclusive' ? 1 : 0);
            return {
              variantId: product.variantId?._id,
              productName: product.variantId?.product?.name || 'Unknown',
              sku: product.variantId?.sku || '',
              attribute: product.variantId?.attribute || '',
              value: product.variantId?.value || '',
              weightQuantity: product.variantId?.weightQuantity || '',
              unit: product.variantId?.unit?.name || 'Unknown',
              image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
              quantity: product.quantity,
              price: parseFloat(product.price.toFixed(2)),
              unitCost: parseFloat(product.unitCost.toFixed(2)),
              taxPercent: product.taxPercent || 0,
              taxType: product.taxType || 'Exclusive',
              taxAmount: parseFloat(taxAmount.toFixed(2)),
              total: parseFloat((product.price * product.quantity + taxAmount).toFixed(2)),
              productDescription: product.variantId?.product?.description || '',
            };
          }),
          createdAt: sale.createdAt,
          updatedAt: sale.updatedAt,
        };
      }),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.deleteSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    // Validate sale ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: false, message: 'Invalid sale ID' });
    }

    // Fetch sale
    const sale = await Sale.findById(id).session(session);
    if (!sale || sale.isDeleted) {
      return res.status(404).json({ status: false, message: 'Sale not found or already deleted' });
    }

    // Prevent deletion of completed or paid sales
    if (sale.status === 'Completed' || sale.payment.amountPaid >= sale.summary.grandTotal) {
      return res.status(400).json({ status: false, message: 'Cannot delete completed or fully paid sales' });
    }

    // Restore stock
    for (const product of sale.products) {
      if (product.variantId && mongoose.Types.ObjectId.isValid(product.variantId)) {
        const variant = await Variant.findById(product.variantId).session(session);
        if (!variant) {
          await session.abortTransaction();
          return res.status(400).json({ status: false, message: `Invalid variant: ${product.variantId}` });
        }
        await Variant.findByIdAndUpdate(
          product.variantId,
          { $inc: { stockQuantity: product.quantity } },
          { runValidators: true, session }
        );
        console.log(`Restored ${product.quantity} units to variant ${product.variantId} for sale ${sale.saleCode}`);
      }
    }

    // Soft delete sale
    sale.isDeleted = true;
    sale.salesHistory.push({
      action: 'Delete',
      changes: { isDeleted: true },
      date: new Date(),
    });
    await sale.save({ session });

    // Commit transaction
    await session.commitTransaction();
    res.status(200).json({ status: true, message: `Sale ${sale.saleCode} soft deleted successfully` });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error deleting sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  } finally {
    session.endSession();
  }
};

exports.updateSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { date, customerId, products, summary, payment, notes, status } = req.body;

    // Validate sale ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: false, message: 'Invalid sale ID' });
    }

    // Fetch sale
    const sale = await Sale.findById(id).session(session);
    if (!sale || sale.isDeleted) {
      return res.status(404).json({ status: false, message: 'Sale not found or deleted' });
    }

    // Validate required fields
    if (!customerId || !products || !summary) {
      return res.status(400).json({ status: false, message: 'Customer ID, products, and summary are required' });
    }

    // Validate status
    if (status && !['Pending', 'Completed', 'Cancelled', 'Refunded'].includes(status)) {
      return res.status(400).json({ status: false, message: 'Status must be one of: Pending, Completed, Cancelled, Refunded' });
    }

    // Validate customer
    const customer = await User.findById(customerId).session(session);
    if (!customer) {
      return res.status(400).json({ status: false, message: 'Invalid customer' });
    }

    // Validate summary fields
    const { otherCharges = 0, discount = 0 } = summary;
    if (typeof otherCharges !== 'number' || otherCharges < 0) {
      return res.status(400).json({ status: false, message: 'otherCharges must be a non-negative number' });
    }
    if (typeof discount !== 'number' || discount < 0) {
      return res.status(400).json({ status: false, message: 'discount must be a non-negative number' });
    }

    // Handle cancellation
    let newProducts = [];
    let subTotal = 0;
    let totalQuantity = 0;
    let taxTotal = 0;

    if (status === 'Cancelled' && sale.status !== 'Cancelled') {
      // Restore stock for all products
      for (const product of sale.products) {
        if (product.variantId && mongoose.Types.ObjectId.isValid(product.variantId)) {
          const variant = await Variant.findById(product.variantId).session(session);
          if (!variant) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: `Invalid variant: ${product.variantId}` });
          }
          await Variant.findByIdAndUpdate(
            product.variantId,
            { $inc: { stockQuantity: product.quantity } },
            { runValidators: true, session }
          );
          console.log(`Restored ${product.quantity} units to variant ${product.variantId} for sale ${sale.saleCode}`);
        }
      }
      // Clear products for cancelled sale
      newProducts = [];
      // sale.products = []; // Ensure no products remain in the sale
      // sale.payment.amountDue = 0;
      // sale.payment.amountPaid = 0;
      // sale.summary.subTotal = 0;
      // sale.summary.taxTotal = 0;
      // sale.summary.grandTotal = 0;
      // sale.summary.totalQuantity = 0;
    } else {
      // Validate products for non-cancelled sales
      if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ status: false, message: 'Products array is required and cannot be empty for non-cancelled sales' });
      }

      for (const prod of products) {
        if (!prod.variantId || !prod.quantity || !prod.price || !prod.unitCost) {
          return res.status(400).json({ status: false, message: 'Each product must have variantId, quantity, price, and unitCost' });
        }
        if (prod.quantity < 1 || prod.price < 0 || prod.unitCost < 0 || (prod.taxPercent && prod.taxPercent < 0)) {
          return res.status(400).json({ status: false, message: 'Quantity, price, unitCost, and taxPercent must be valid' });
        }
        if (prod.taxType && !['Inclusive', 'Exclusive'].includes(prod.taxType)) {
          return res.status(400).json({ status: false, message: 'taxType must be Inclusive or Exclusive' });
        }

        const variant = await Variant.findById(prod.variantId).session(session);
        const oldProduct = sale.products.find(p => p.variantId.toString() === prod.variantId.toString());
        const availableStock = variant ? variant.stockQuantity + (oldProduct ? oldProduct.quantity : 0) : 0;
        if (!variant || variant.status === 'Inactive' || availableStock < prod.quantity) {
          await session.abortTransaction();
          return res.status(400).json({ status: false, message: `Insufficient stock or invalid variant: ${prod.variantId}` });
        }

        const taxAmount = (prod.price * prod.quantity * (prod.taxPercent || 0)) / 100 * (prod.taxType === 'Exclusive' ? 1 : 0);
        const productTotal = prod.price * prod.quantity + taxAmount;
        subTotal += productTotal;
        taxTotal += taxAmount;
        totalQuantity += prod.quantity;
        newProducts.push({
          variantId: prod.variantId,
          quantity: prod.quantity,
          price: prod.price,
          taxPercent: prod.taxPercent || 0,
          taxType: prod.taxType || 'Exclusive',
          unitCost: prod.unitCost,
        });
      }

      // Restore ALL stock for old products
      for (const oldProd of sale.products) {
        if (oldProd.variantId && mongoose.Types.ObjectId.isValid(oldProd.variantId)) {
          await Variant.findByIdAndUpdate(
            oldProd.variantId,
            { $inc: { stockQuantity: oldProd.quantity } },
            { runValidators: true, session }
          );
          console.log(`Restored ${oldProd.quantity} units to variant ${oldProd.variantId} for sale ${sale.saleCode}`);
        }
      }

      // Deduct stock for new products (only if not Cancelled)
      if (status !== 'Cancelled') {
        for (const newProd of newProducts) {
          if (newProd.variantId && mongoose.Types.ObjectId.isValid(newProd.variantId)) {
            await Variant.findByIdAndUpdate(
              newProd.variantId,
              { $inc: { stockQuantity: -newProd.quantity } },
              { runValidators: true, session }
            );
            console.log(`Deducted ${newProd.quantity} units from variant ${newProd.variantId} for sale ${sale.saleCode}`);
          }
        }
      }
    }

    // Validate summary calculations
    const grandTotal = subTotal + otherCharges - discount;
    if (grandTotal < 0) {
      return res.status(400).json({ status: false, message: 'Grand total cannot be negative' });
    }

    // Validate payment
    if (payment) {
      if (typeof payment.amountPaid !== 'number' || payment.amountPaid < 0) {
        return res.status(400).json({ status: false, message: 'payment.amountPaid must be a non-negative number' });
      }
      if (payment.type && !['Cash', 'Card', 'Online', 'BankTransfer'].includes(payment.type)) {
        return res.status(400).json({ status: false, message: 'Invalid payment type' });
      }
    }
    const amountPaid = payment?.amountPaid ?? sale.payment.amountPaid;
    const amountDue = grandTotal - amountPaid;
    if (amountDue < 0) {
      return res.status(400).json({ status: false, message: 'Amount paid cannot exceed grand total' });
    }

    // Log history
    sale.salesHistory.push({
      action: 'Update',
      changes: { date, customerId, products, summary, payment, notes, status },
      date: new Date(),
    });

    // Update sale
    sale.set({
      date: date && new Date(date) <= new Date() ? date : sale.date,
      customerId,
      products: newProducts,
      status: status ?? sale.status,
      payment: {
        type: payment?.type ?? sale.payment.type,
        amountPaid,
        amountDue,
        notes: payment?.notes ?? sale.payment.notes,
      },
      summary: {
        totalQuantity,
        subTotal,
        taxTotal,
        discount,
        otherCharges,
        grandTotal,
      },
      notes: notes ?? sale.notes,
    });

    await sale.save({ session });

    // Populate response
    const updatedSale = await Sale.findById(id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' },
        ],
      })
      .session(session);

    await session.commitTransaction();
    res.status(200).json({
      status: true,
      message: 'Sale updated successfully',
      data: {
        _id: updatedSale._id,
        saleCode: updatedSale.saleCode,
        date: updatedSale.date,
        status: updatedSale.status,
        notes: updatedSale.notes,
        customer: {
          id: updatedSale.customerId?._id,
          name: updatedSale.customerId?.name || 'Walk-in Customer',
          email: updatedSale.customerId?.email || '',
          phone: updatedSale.customerId?.phone || '',
        },
        products: updatedSale.products.map((product) => {
          const variant = product.variantId;
          const taxAmount = (product.price * product.quantity * (product.taxPercent || 0)) / 100 * (product.taxType === 'Exclusive' ? 1 : 0);
          return {
            variantId: variant?._id,
            productName: variant?.product?.name || 'Unknown',
            sku: variant?.sku || '',
            attribute: variant?.attribute || '',
            value: variant?.value || '',
            weightQuantity: variant?.weightQuantity || '',
            unit: variant?.unit?.name || 'Unknown',
            unitSymbol: variant?.unit?.symbol || '',
            image: variant?.product?.thumbnail || variant?.image || '',
            quantity: product.quantity,
            price: parseFloat(product.price.toFixed(2)),
            unitCost: parseFloat(product.unitCost.toFixed(2)),
            taxPercent: product.taxPercent || 0,
            taxType: product.taxType || 'Exclusive',
            taxAmount: parseFloat(taxAmount.toFixed(2)),
            total: parseFloat((product.price * product.quantity + taxAmount).toFixed(2)),
          };
        }),
        summary: {
          totalQuantity: updatedSale.summary.totalQuantity,
          subTotal: parseFloat(updatedSale.summary.subTotal.toFixed(2)),
          taxTotal: parseFloat(updatedSale.summary.taxTotal.toFixed(2)),
          discount: parseFloat(updatedSale.summary.discount.toFixed(2)),
          otherCharges: parseFloat(updatedSale.summary.otherCharges.toFixed(2)),
          grandTotal: parseFloat(updatedSale.summary.grandTotal.toFixed(2)),
        },
        payment: {
          type: updatedSale.payment.type || null,
          amountPaid: parseFloat(updatedSale.payment.amountPaid.toFixed(2)),
          amountDue: parseFloat(updatedSale.payment.amountDue.toFixed(2)),
          notes: updatedSale.payment.notes || '',
        },
        createdAt: updatedSale.createdAt,
        updatedAt: updatedSale.updatedAt,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error updating sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  } finally {
    session.endSession();
  }
};

exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Sale.findById(id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' }
        ],
      });
    if (!sale || sale.isDeleted) return res.status(404).json({ status: false, message: 'Sale not found' });

    res.status(200).json({ 
      status: true, 
      message: 'Sale fetched successfully',
      data: {
        _id: sale._id,
        saleCode: sale.saleCode,
        date: sale.date,
        status: sale.status,
        notes: sale.notes,
        customer: {
          id: sale.customerId?._id,
          name: sale.customerId?.name || 'Walk-in Customer',
          email: sale.customerId?.email || '',
          phone: sale.customerId?.phone || '',
        },
        products: sale.products.map((product) => {
          const variant = product.variantId;
          const taxAmount = (product.price * product.quantity * (product.taxPercent || 0)) / 100 
                          * (product.taxType === 'Exclusive' ? 1 : 0);
          return {
            variantId: variant?._id,
            productName: variant?.product?.name || 'Unknown',
            sku: variant?.sku || '',
            attribute: variant?.attribute || '',
            value: variant?.value || '',
            weightQuantity: variant?.weightQuantity || '',
            unit: variant?.unit?.name || 'Unknown',
            unitSymbol: variant?.unit?.symbol || '',
            image: variant?.product?.thumbnail || variant?.image || '',
            quantity: product.quantity,
            price: parseFloat(product.price.toFixed(2)),
            unitCost: parseFloat(product.unitCost.toFixed(2)),
            taxPercent: product.taxPercent || 0,
            taxType: product.taxType || 'Exclusive',
            taxAmount: parseFloat(taxAmount.toFixed(2)),
            total: parseFloat((product.price * product.quantity + taxAmount).toFixed(2)),
          };
        }),
        summary: {
          totalQuantity: sale.summary.totalQuantity,
          subTotal: parseFloat(sale.summary.subTotal.toFixed(2)),
          taxTotal: parseFloat(sale.summary.taxTotal.toFixed(2)),
          discount: parseFloat(sale.summary.discount.toFixed(2)),
          otherCharges: parseFloat(sale.summary.otherCharges.toFixed(2)),
          grandTotal: parseFloat(sale.summary.grandTotal.toFixed(2)),
        },
        payment: {
          type: sale.payment.type || null,
          amountPaid: parseFloat(sale.payment.amountPaid.toFixed(2)),
          amountDue: parseFloat(sale.payment.amountDue.toFixed(2)),
          notes: sale.payment.notes || '',
        },
        createdAt: sale.createdAt,
        updatedAt: sale.updatedAt,
      }
    });
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};