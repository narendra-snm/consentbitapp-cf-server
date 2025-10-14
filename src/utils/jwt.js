import { SignJWT, jwtVerify } from "jose";

export async function generateToken(payload, secret, exp = "1h") {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(exp)
    .sign(secret);
}

export async function verifyToken(token, secret) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}
