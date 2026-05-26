import nodemailer from "nodemailer";
import { config } from "../../config/index.js";

export class MailService {
    private transporter: nodemailer.Transporter | null = null;

    constructor() {
        if (config.mail.host && config.mail.user && config.mail.pass) {
            this.transporter = nodemailer.createTransport({
                host: config.mail.host,
                port: config.mail.port,
                secure: config.mail.port === 465,
                auth: {
                    user: config.mail.user,
                    pass: config.mail.pass,
                },
            });
        }
    }

    async sendMail(to: string, subject: string, text: string, html: string): Promise<boolean> {
        if (this.transporter) {
            try {
                await this.transporter.sendMail({
                    from: config.mail.from,
                    to,
                    subject,
                    text,
                    html,
                });
                console.log(`[SMTP] Email successfully sent to ${to}`);
                return true;
            } catch (error) {
                console.error("[SMTP] Failed to send email via SMTP, falling back to console logging:", error);
            }
        }

        // Fallback/Mock Mode if keys are not configured or SMTP fails
        console.log("\n=================================================");
        console.log(`[MAIL SERVICE] (DEVELOPMENT/FALLBACK MOCK SEND)`);
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Text Content:\n${text}`);
        console.log("=================================================\n");
        return true;
    }

    async sendOTP(to: string, otpCode: string): Promise<boolean> {
        const subject = "Your Soho OTP Verification Code";
        const text = `Your OTP verification code is: ${otpCode}. This code is valid for 5 minutes.`;
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #0f172a; text-align: center;">Soho Verification</h2>
                <p style="color: #475569; font-size: 16px;">Hello,</p>
                <p style="color: #475569; font-size: 16px;">Your OTP verification code is:</p>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #0055d4; margin: 20px 0; border-radius: 8px;">
                    ${otpCode}
                </div>
                <p style="color: #64748b; font-size: 14px; text-align: center;">This code will expire in 5 minutes. If you did not request this code, please ignore this email.</p>
            </div>
        `;
        return this.sendMail(to, subject, text, html);
    }

    async sendPasswordResetLink(to: string, resetLink: string, token: string): Promise<boolean> {
        const subject = "Reset Your Soho Password";
        // Also provide a 6-digit mockup OTP from the last 6 chars of token, or just a clear way to see/use it!
        const otpCode = token.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, '9');
        const text = `Please reset your password using the following link: ${resetLink}\nAlternatively, use the following code: ${otpCode}`;
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #0f172a; text-align: center;">Reset Your Password</h2>
                <p style="color: #475569; font-size: 16px;">Hello,</p>
                <p style="color: #475569; font-size: 16px;">You requested a password reset. You can complete it using the link below:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}" style="background-color: #0055d4; color: white; padding: 12px 24px; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 8px;">Reset Password</a>
                </div>
                <p style="color: #475569; font-size: 16px;">Alternatively, if you are asked for a verification code in the application, enter the code below:</p>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #0055d4; margin: 20px 0; border-radius: 8px;">
                    ${otpCode}
                </div>
                <p style="color: #64748b; font-size: 14px; text-align: center;">If you did not request a password reset, you can safely ignore this email.</p>
            </div>
        `;
        return this.sendMail(to, subject, text, html);
    }
}
