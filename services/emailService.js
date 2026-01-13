const Order = require("../model/Order");
const EmailTemplate = require("../model/EmailTemplate");
const sendEmail = require("../utils/sendEmail");

async function sendOrderPlacedEmail(orderId) {
  try {
    const order = await Order.findById(orderId).populate("items.product");
    if (!order) throw new Error("Order not found");

    const template = await EmailTemplate.findOne({ type: "order_placed", status: "active" });
    if (!template) throw new Error("Email template not found");

    let html = template.content;

    const productRows = order.items.map(item => `
      <tr>
        <td>${item.product?.name || "Product"}</td>
        <td align="center">${item.quantity}</td>
        <td align="right">${item.price}</td>
        <td align="right">${item.total}</td>
      </tr>
    `).join("");

    const shippingAddress = `
      ${order.shippingAddress.fullName}, 
      ${order.shippingAddress.street}, 
      ${order.shippingAddress.city}, 
      ${order.shippingAddress.state || ""}, 
      ${order.shippingAddress.zip}
    `;

    html = html.replace(/{{customerName}}/g, order.shippingAddress.fullName);
    html = html.replace(/{{orderId}}/g, order.orderNumber);
    html = html.replace(/{{orderTotal}}/g, order.total);
    html = html.replace(/{{paymentMethod}}/g, order.paymentMethod);
    html = html.replace(/{{shippingAddress}}/g, shippingAddress);
    html = html.replace(/{{productRows}}/g, productRows);
    html = html.replace(/{{orderTrackingUrl}}/g, `https://yourdomain.com/track/${order.orderTrackingNumber}`);

    await sendEmail(
      order.shippingAddress.email,
      template.subject.replace(/{{orderId}}/g, order.orderNumber),
      html
    );

    console.log("✅ Order email sent successfully");

  } catch (error) {
    console.error("❌ Order email failed:", error.message);
  }
}

module.exports = sendOrderPlacedEmail;
