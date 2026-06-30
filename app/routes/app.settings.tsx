import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  FormLayout,
  TextField,
  Text,
  Divider,
  Button,
  Checkbox,
  BlockStack,
  Badge,
  InlineStack,
  Box,
} from "@shopify/polaris";
import { useEffect, useState, type ReactNode } from "react";

import { EstimatedVanProgress } from "../components/EstimatedVanProgress";
import {
  getAppCredentials,
  getStoredAppCredentials,
  hasGetAddressCredentials,
  hasProofPhotoStorageCredentials,
  hasResendCredentials,
  hasRouteXLCredentials,
  hasTomTomCredentials,
  hasTwilioCredentials,
  saveAppCredentialsPatch,
  type AppCredentials,
} from "../lib/appCredentials.server";
import { defaultCountry, formatStructuredAddress, type StructuredAddress } from "../lib/addressFields";
import { getCustomerTrackingSettings, saveCustomerTrackingSettings, type CustomerTrackingSettings } from "../lib/customerTrackingSettings.server";
import { getRouteSettings, saveRouteSettings } from "../lib/routeSettings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [routeSettings, storedCredentials, effectiveCredentials, customerTrackingSettings] = await Promise.all([
    getRouteSettings(),
    getStoredAppCredentials(),
    getAppCredentials(),
    getCustomerTrackingSettings(),
  ]);

  return json({
    routeSettings,
    storedCredentials,
    customerTrackingSettings,
    credentialStatus: {
      routexlEnabled: hasRouteXLCredentials(effectiveCredentials),
      tomtomEnabled: hasTomTomCredentials(effectiveCredentials),
      getAddressEnabled: hasGetAddressCredentials(effectiveCredentials),
      twilioEnabled: hasTwilioCredentials(effectiveCredentials),
      resendEnabled: hasResendCredentials(effectiveCredentials),
      proofPhotoStorageEnabled: hasProofPhotoStorageCredentials(effectiveCredentials),
      shopPublicUrlEnabled: Boolean(effectiveCredentials.shopPublicUrl),
    },
  });
};

function formValue(formData: FormData, key: keyof AppCredentials) {
  return String(formData.get(key) || "").trim();
}

function settingValue(formData: FormData, key: keyof CustomerTrackingSettings) {
  return String(formData.get(key) || "").trim();
}

function formCoordinate(formData: FormData, key: string) {
  const value = String(formData.get(key) || "").trim();
  if (!value) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function structuredAddressFromForm(formData: FormData, prefix: string): StructuredAddress {
  return {
    building: String(formData.get(`${prefix}Building`) || "").trim(),
    addressLine1: String(formData.get(`${prefix}AddressLine1`) || "").trim(),
    addressLine2: String(formData.get(`${prefix}AddressLine2`) || "").trim(),
    town: String(formData.get(`${prefix}Town`) || "").trim(),
    county: String(formData.get(`${prefix}County`) || "").trim(),
    postcode: String(formData.get(`${prefix}Postcode`) || "").trim(),
    country: String(formData.get(`${prefix}Country`) || defaultCountry).trim(),
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "saveRouteSettings");

  if (intent === "saveTomTom") {
    await saveAppCredentialsPatch({ tomtomApiKey: formValue(formData, "tomtomApiKey") });
    return json({ ok: true, savedSection: "TomTom" });
  }

  if (intent === "saveGetAddress") {
    await saveAppCredentialsPatch({ getAddressApiKey: formValue(formData, "getAddressApiKey") });
    return json({ ok: true, savedSection: "getAddress.io" });
  }

  if (intent === "saveRouteXL") {
    await saveAppCredentialsPatch({ routexlUsername: formValue(formData, "routexlUsername"), routexlPassword: formValue(formData, "routexlPassword") });
    return json({ ok: true, savedSection: "RouteXL" });
  }

  if (intent === "saveTwilio") {
    await saveAppCredentialsPatch({ twilioAccountSid: formValue(formData, "twilioAccountSid"), twilioAuthToken: formValue(formData, "twilioAuthToken"), twilioFromNumber: formValue(formData, "twilioFromNumber") });
    return json({ ok: true, savedSection: "Twilio" });
  }

  if (intent === "saveResend") {
    await saveAppCredentialsPatch({ resendApiKey: formValue(formData, "resendApiKey"), resendFromEmail: formValue(formData, "resendFromEmail") });
    return json({ ok: true, savedSection: "Resend" });
  }

  if (intent === "saveProofPhotoStorage") {
    await saveAppCredentialsPatch({
      proofPhotoStorageEndpoint: formValue(formData, "proofPhotoStorageEndpoint"),
      proofPhotoStorageRegion: formValue(formData, "proofPhotoStorageRegion"),
      proofPhotoStorageBucket: formValue(formData, "proofPhotoStorageBucket"),
      proofPhotoStorageAccessKeyId: formValue(formData, "proofPhotoStorageAccessKeyId"),
      proofPhotoStorageSecretAccessKey: formValue(formData, "proofPhotoStorageSecretAccessKey"),
      proofPhotoPublicBaseUrl: formValue(formData, "proofPhotoPublicBaseUrl"),
    });
    return json({ ok: true, savedSection: "Proof photo storage" });
  }

  if (intent === "saveTrackingUrl") {
    await saveAppCredentialsPatch({ shopPublicUrl: formValue(formData, "shopPublicUrl") });
    return json({ ok: true, savedSection: "Tracking URL" });
  }

  if (intent === "saveCustomerTracking") {
    const customerTrackingSettings = await saveCustomerTrackingSettings({
      companyName: settingValue(formData, "companyName"),
      logoUrl: settingValue(formData, "logoUrl"),
      primaryColour: settingValue(formData, "primaryColour"),
      supportPhone: settingValue(formData, "supportPhone"),
      supportEmail: settingValue(formData, "supportEmail"),
      heroOutForDeliveryTitle: settingValue(formData, "heroOutForDeliveryTitle"),
      heroPlannedTitle: settingValue(formData, "heroPlannedTitle"),
      heroDeliveredTitle: settingValue(formData, "heroDeliveredTitle"),
      heroAttemptedTitle: settingValue(formData, "heroAttemptedTitle"),
      outForDeliveryMessage: settingValue(formData, "outForDeliveryMessage"),
      notNextMessage: settingValue(formData, "notNextMessage"),
      deliveredMessage: settingValue(formData, "deliveredMessage"),
      attemptedMessage: settingValue(formData, "attemptedMessage"),
      roomOfChoiceText: settingValue(formData, "roomOfChoiceText"),
      progressLineColour: settingValue(formData, "progressLineColour"),
      vanLabel: settingValue(formData, "vanLabel"),
      vanBackgroundColour: settingValue(formData, "vanBackgroundColour"),
      vanTextColour: settingValue(formData, "vanTextColour"),
      homeLabel: settingValue(formData, "homeLabel"),
      homeBackgroundColour: settingValue(formData, "homeBackgroundColour"),
      homeBorderColour: settingValue(formData, "homeBorderColour"),
      homeTextColour: settingValue(formData, "homeTextColour"),
      previewItemOne: settingValue(formData, "previewItemOne"),
      previewItemTwo: settingValue(formData, "previewItemTwo"),
      previewItemThree: settingValue(formData, "previewItemThree"),
      customFooterHtml: settingValue(formData, "customFooterHtml"),
      customCss: settingValue(formData, "customCss"),
    });

    return json({ ok: true, customerTrackingSettings, savedSection: "Customer tracking screen" });
  }

  const routeSettings = await saveRouteSettings({
    plannedStartTime: String(formData.get("plannedStartTime") || ""),
    timePerDropMinutes: Number(formData.get("timePerDropMinutes") || 10),
    customerSlotMinutes: Number(formData.get("customerSlotMinutes") || 60),
    fulfilmentWindowDays: Number(formData.get("fulfilmentWindowDays") || 7),
    useWorkingDaysOnly: String(formData.get("useWorkingDaysOnly") || "") === "true",
    startStructuredAddress: structuredAddressFromForm(formData, "start"),
    startLatitude: formCoordinate(formData, "startLatitude"),
    startLongitude: formCoordinate(formData, "startLongitude"),
    returnToBaseDefault: String(formData.get("returnToBaseDefault") || "") === "true",
  });

  return json({ ok: true, routeSettings, savedSection: "Route settings" });
};

function statusBadge(enabled: boolean, label: string) {
  return <Badge tone={enabled ? "success" : "warning"}>{`${label} ${enabled ? "enabled" : "not set up"}`}</Badge>;
}

function TabButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ border: active ? "1px solid #509AE6" : "1px solid #d0d5dd", background: active ? "#509AE6" : "#ffffff", color: active ? "#ffffff" : "#323841", borderRadius: 999, padding: "10px 14px", fontWeight: 800, cursor: "pointer" }}>{children}</button>;
}

function StructuredAddressFields({ address, onChange, prefix }: { address: StructuredAddress; onChange: (address: StructuredAddress) => void; prefix: string }) {
  const setField = (field: keyof StructuredAddress) => (value: string) => onChange({ ...address, [field]: value });
  return <BlockStack gap="300"><FormLayout.Group><TextField label="House number, unit or building name" name={`${prefix}Building`} value={address.building} onChange={setField("building")} autoComplete="off" /><TextField label="Street / address line 1" name={`${prefix}AddressLine1`} value={address.addressLine1} onChange={setField("addressLine1")} autoComplete="off" /></FormLayout.Group><TextField label="Address line 2, optional" name={`${prefix}AddressLine2`} value={address.addressLine2} onChange={setField("addressLine2")} autoComplete="off" /><FormLayout.Group><TextField label="Town / city" name={`${prefix}Town`} value={address.town} onChange={setField("town")} autoComplete="off" /><TextField label="County" name={`${prefix}County`} value={address.county} onChange={setField("county")} autoComplete="off" /></FormLayout.Group><FormLayout.Group><TextField label="Postcode" name={`${prefix}Postcode`} value={address.postcode} onChange={setField("postcode")} autoComplete="off" /><TextField label="Country" name={`${prefix}Country`} value={address.country} onChange={setField("country")} autoComplete="off" /></FormLayout.Group></BlockStack>;
}

function ApiCredentialForm({ title, enabled, label, intent, children, saved }: { title: string; enabled: boolean; label: string; intent: string; children: ReactNode; saved: boolean }) {
  return <Form method="post"><input type="hidden" name="intent" value={intent} /><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><Text as="h3" variant="headingMd">{title}</Text><InlineStack gap="200" blockAlign="center">{saved ? <Badge tone="success">Saved</Badge> : null}{statusBadge(enabled, label)}<Button submit variant="primary">Save</Button></InlineStack></InlineStack>{children}</BlockStack></Form>;
}

function previewItems(settings: CustomerTrackingSettings) {
  return [settings.previewItemOne, settings.previewItemTwo, settings.previewItemThree].map((item) => item.trim()).filter(Boolean);
}

function CustomerPreviewPage({ settings, mode }: { settings: CustomerTrackingSettings; mode: "desktop" | "mobile" }) {
  const primaryColour = settings.primaryColour || "#509AE6";
  const visuals = {
    progressLineColour: settings.progressLineColour,
    vanLabel: settings.vanLabel,
    vanBackgroundColour: settings.vanBackgroundColour,
    vanTextColour: settings.vanTextColour,
    homeLabel: settings.homeLabel,
    homeBackgroundColour: settings.homeBackgroundColour,
    homeBorderColour: settings.homeBorderColour,
    homeTextColour: settings.homeTextColour,
  };
  const items = previewItems(settings);
  const mobile = mode === "mobile";

  return <div style={{ background: "#eef4fb", borderRadius: mobile ? 24 : 18, padding: mobile ? 12 : 20, minHeight: mobile ? 820 : 760, width: mobile ? 390 : "100%", maxWidth: mobile ? 390 : 1000, margin: "0 auto", overflow: "auto", border: "1px solid #d0d5dd" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>{settings.logoUrl ? <img src={settings.logoUrl} alt={settings.companyName} style={{ maxHeight: 54, maxWidth: 210, objectFit: "contain" }} /> : <strong style={{ color: primaryColour, fontSize: 18 }}>{settings.companyName}</strong>}<span style={{ border: `1px solid ${primaryColour}`, color: primaryColour, background: "#fff", borderRadius: 999, padding: "10px 14px", fontWeight: 900 }}>Refresh</span></div><div style={{ background: `linear-gradient(135deg, ${primaryColour}, #2578bd)`, color: "#fff", borderRadius: 26, padding: mobile ? 20 : 24, boxShadow: "0 18px 44px rgba(50,56,65,.18)" }}><h1 style={{ margin: 0, fontSize: mobile ? 29 : 34, lineHeight: 1.05 }}>{settings.heroOutForDeliveryTitle}</h1><p style={{ margin: "12px 0 0", fontWeight: 700 }}>{settings.outForDeliveryMessage}</p><div style={{ marginTop: 18, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.28)", borderRadius: 20, padding: 16, display: "grid", gap: 5 }}><span style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: .5, fontWeight: 900 }}>Estimated arrival</span><strong style={{ fontSize: mobile ? 24 : 28 }}>Today between 10:30 and 11:30</strong><span style={{ fontSize: 13, fontWeight: 900 }}>Order #1234 · Last updated 10:02</span></div></div><div style={{ marginTop: 16, background: "#fff", borderRadius: 22, padding: 18, display: "flex", gap: 14, alignItems: "center", boxShadow: "0 10px 28px rgba(50,56,65,.1)" }}><div style={{ width: 74, height: 74, borderRadius: "50%", background: primaryColour, color: "#fff", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 24 }}>CG</div><div><h2 style={{ margin: 0, fontSize: 22 }}>Your driver today is Chris</h2><p style={{ margin: "7px 0 0", color: "#667085" }}>{settings.roomOfChoiceText}</p></div></div><div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 10, marginTop: 16 }}><span style={{ background: primaryColour, color: "#fff", borderRadius: 18, padding: 15, textAlign: "center", fontWeight: 900 }}>Call our team</span><span style={{ background: "#323841", color: "#fff", borderRadius: 18, padding: 15, textAlign: "center", fontWeight: 900 }}>Email our team</span></div><div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1.4fr .8fr", gap: 16, marginTop: 16 }}><div style={{ background: "#fff", borderRadius: 22, padding: 18, boxShadow: "0 10px 28px rgba(50,56,65,.1)" }}><EstimatedVanProgress active estimatedArrival={new Date()} currentTime={new Date()} message={settings.outForDeliveryMessage} visuals={visuals} previewPercent={64} /></div><div style={{ background: "#fff", borderRadius: 22, padding: 18, boxShadow: "0 10px 28px rgba(50,56,65,.1)" }}><h2 style={{ margin: 0, fontSize: 22 }}>Delivery details</h2><div style={{ display: "grid", gap: 10, marginTop: 14 }}><div style={{ background: "#f8fafc", borderRadius: 16, padding: 12 }}><span style={{ display: "block", color: "#667085", fontSize: 13 }}>Status</span><strong>Out for delivery</strong></div><div style={{ background: "#f8fafc", borderRadius: 16, padding: 12 }}><span style={{ display: "block", color: "#667085", fontSize: 13 }}>Your drop</span><strong>Number 3</strong></div><div style={{ background: "#f8fafc", borderRadius: 16, padding: 12 }}><span style={{ display: "block", color: "#667085", fontSize: 13 }}>Before you</span><strong>You are next</strong></div></div><div style={{ marginTop: 12, background: "#f8fafc", borderRadius: 16, padding: 12 }}><strong>Your order</strong><ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "#667085" }}>{items.map((item) => <li key={item}>{item}</li>)}</ul></div></div></div>{settings.customFooterHtml ? <div style={{ marginTop: 16 }} dangerouslySetInnerHTML={{ __html: settings.customFooterHtml }} /> : null}</div>;
}

function CustomerTrackingPreview({ settings }: { settings: CustomerTrackingSettings }) {
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const [fullScreen, setFullScreen] = useState(false);
  return <LegacyCard title="Customer tracking preview" sectioned><BlockStack gap="400"><InlineStack align="space-between" blockAlign="center"><Text as="p" variant="bodyMd" tone="subdued">Preview the full customer tracking page using your current settings.</Text><InlineStack gap="200"><TabButton active={mode === "desktop"} onClick={() => setMode("desktop")}>Desktop</TabButton><TabButton active={mode === "mobile"} onClick={() => setMode("mobile")}>Mobile</TabButton><Button onClick={() => setFullScreen(true)} variant="primary">Full screen preview</Button></InlineStack></InlineStack><CustomerPreviewPage settings={settings} mode={mode} /><Text as="p" variant="bodySm" tone="subdued">Preview products are placeholders only. The live customer page uses the real order items from the connected store.</Text>{fullScreen ? <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(17,24,39,.92)", padding: 18, overflow: "auto" }}><div style={{ maxWidth: mode === "mobile" ? 440 : 1100, margin: "0 auto" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 12 }}><div style={{ display: "flex", gap: 8 }}><TabButton active={mode === "desktop"} onClick={() => setMode("desktop")}>Desktop</TabButton><TabButton active={mode === "mobile"} onClick={() => setMode("mobile")}>Mobile</TabButton></div><button type="button" onClick={() => setFullScreen(false)} style={{ border: 0, background: "#fff", color: "#323841", borderRadius: 999, padding: "10px 16px", fontWeight: 900 }}>Close preview</button></div><CustomerPreviewPage settings={settings} mode={mode} /></div></div> : null}</BlockStack></LegacyCard>;
}

export default function Settings() {
  const { routeSettings, storedCredentials, credentialStatus, customerTrackingSettings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentSettings = actionData && "routeSettings" in actionData && actionData.routeSettings ? actionData.routeSettings : routeSettings;
  const currentCustomerTrackingSettings = actionData && "customerTrackingSettings" in actionData && actionData.customerTrackingSettings ? actionData.customerTrackingSettings : customerTrackingSettings;
  const [activeTab, setActiveTab] = useState("delivery");
  const [credentials, setCredentials] = useState(storedCredentials);
  const [trackingSettings, setTrackingSettings] = useState<CustomerTrackingSettings>(currentCustomerTrackingSettings);
  const [plannedStartTime, setPlannedStartTime] = useState(currentSettings.plannedStartTime);
  const [timePerDropMinutes, setTimePerDropMinutes] = useState(String(currentSettings.timePerDropMinutes));
  const [customerSlotMinutes, setCustomerSlotMinutes] = useState(String(currentSettings.customerSlotMinutes));
  const [fulfilmentWindowDays, setFulfilmentWindowDays] = useState(String(currentSettings.fulfilmentWindowDays || 7));
  const [useWorkingDaysOnly, setUseWorkingDaysOnly] = useState(currentSettings.useWorkingDaysOnly ?? true);
  const [startStructuredAddress, setStartStructuredAddress] = useState<StructuredAddress>(currentSettings.startStructuredAddress);
  const [startLatitude, setStartLatitude] = useState(currentSettings.startLatitude === null ? "" : String(currentSettings.startLatitude));
  const [startLongitude, setStartLongitude] = useState(currentSettings.startLongitude === null ? "" : String(currentSettings.startLongitude));
  const [returnToBaseDefault, setReturnToBaseDefault] = useState(currentSettings.returnToBaseDefault);

  useEffect(() => { setPlannedStartTime(currentSettings.plannedStartTime); setTimePerDropMinutes(String(currentSettings.timePerDropMinutes)); setCustomerSlotMinutes(String(currentSettings.customerSlotMinutes)); setFulfilmentWindowDays(String(currentSettings.fulfilmentWindowDays || 7)); setUseWorkingDaysOnly(currentSettings.useWorkingDaysOnly ?? true); setStartStructuredAddress(currentSettings.startStructuredAddress); setStartLatitude(currentSettings.startLatitude === null ? "" : String(currentSettings.startLatitude)); setStartLongitude(currentSettings.startLongitude === null ? "" : String(currentSettings.startLongitude)); setReturnToBaseDefault(currentSettings.returnToBaseDefault); }, [currentSettings]);
  useEffect(() => setCredentials(storedCredentials), [storedCredentials]);
  useEffect(() => setTrackingSettings(currentCustomerTrackingSettings), [currentCustomerTrackingSettings]);

  const setCredential = (key: keyof AppCredentials) => (value: string) => setCredentials((current) => ({ ...current, [key]: value }));
  const setTracking = (key: keyof CustomerTrackingSettings) => (value: string) => setTrackingSettings((current) => ({ ...current, [key]: value }));

  return <Page title="Settings"><Layout><Layout.Section><LegacyCard sectioned><InlineStack gap="200" wrap><TabButton active={activeTab === "delivery"} onClick={() => setActiveTab("delivery")}>Delivery settings</TabButton><TabButton active={activeTab === "notifications"} onClick={() => setActiveTab("notifications")}>Notifications</TabButton><TabButton active={activeTab === "tracking"} onClick={() => setActiveTab("tracking")}>Customer tracking screen</TabButton><TabButton active={activeTab === "maps"} onClick={() => setActiveTab("maps")}>Maps and address lookup</TabButton><TabButton active={activeTab === "storage"} onClick={() => setActiveTab("storage")}>Storage and developer</TabButton></InlineStack></LegacyCard></Layout.Section>

  {activeTab === "delivery" ? <Layout.Section><LegacyCard title="Route Planning Defaults" sectioned><Form method="post"><input type="hidden" name="intent" value="saveRouteSettings" /><BlockStack gap="400"><Text as="p" variant="bodyMd" tone="subdued">These values are used automatically on the Orders Map when building a new delivery route.</Text>{actionData?.ok && actionData.savedSection === "Route settings" ? <Badge tone="success">Route settings saved</Badge> : null}<FormLayout><FormLayout.Group><TextField label="Default driver start time" name="plannedStartTime" value={plannedStartTime} onChange={setPlannedStartTime} type="time" autoComplete="off" /><TextField label="Default minutes per drop" name="timePerDropMinutes" value={timePerDropMinutes} onChange={setTimePerDropMinutes} type="number" autoComplete="off" /></FormLayout.Group><TextField label="Default customer delivery slot minutes" name="customerSlotMinutes" value={customerSlotMinutes} onChange={setCustomerSlotMinutes} type="number" autoComplete="off" helpText="60 means customers get a one hour delivery slot." /><BlockStack gap="300"><Text as="h3" variant="headingMd">Fulfilment hover settings</Text><TextField label="Fulfilment window days" name="fulfilmentWindowDays" value={fulfilmentWindowDays} onChange={setFulfilmentWindowDays} type="number" autoComplete="off" helpText="Used for the fulfil by date shown in the map hover card." /><Checkbox label="Use working days only, exclude weekends and bank holidays" checked={useWorkingDaysOnly} onChange={setUseWorkingDaysOnly} helpText="Ticked means weekends and England and Wales bank holidays are not counted." /><input type="hidden" name="useWorkingDaysOnly" value={useWorkingDaysOnly ? "true" : "false"} /></BlockStack><BlockStack gap="300"><Text as="h3" variant="headingMd">Default route start address</Text><StructuredAddressFields address={startStructuredAddress} onChange={setStartStructuredAddress} prefix="start" /><FormLayout.Group><TextField label="Exact depot latitude" name="startLatitude" value={startLatitude} onChange={setStartLatitude} autoComplete="off" /><TextField label="Exact depot longitude" name="startLongitude" value={startLongitude} onChange={setStartLongitude} autoComplete="off" /></FormLayout.Group><Box background="bg-surface-secondary" padding="300" borderRadius="300"><BlockStack gap="100"><Text as="p" variant="bodySm" fontWeight="bold">Saved address format</Text><Text as="p" variant="bodySm" tone="subdued">{formatStructuredAddress(startStructuredAddress) || currentSettings.startAddress}</Text>{currentSettings.startLatitude && currentSettings.startLongitude ? <Text as="p" variant="bodySm" tone="subdued">Coordinates saved: {currentSettings.startLatitude}, {currentSettings.startLongitude}</Text> : <Text as="p" variant="bodySm" tone="critical">Coordinates not saved yet.</Text>}</BlockStack></Box></BlockStack><Checkbox label="Return to base by default" checked={returnToBaseDefault} onChange={setReturnToBaseDefault} helpText="When ticked, new routes finish at the same address as the start point unless you set a custom finish on the planning page." /><input type="hidden" name="returnToBaseDefault" value={returnToBaseDefault ? "true" : "false"} /><Button submit variant="primary">Save route settings</Button></FormLayout></BlockStack></Form></LegacyCard></Layout.Section> : null}

  {activeTab === "notifications" ? <Layout.Section><LegacyCard title="Notifications" sectioned><BlockStack gap="500"><Text as="p" variant="bodyMd" tone="subdued">SMS and email provider settings used when sending driver links and customer updates.</Text><ApiCredentialForm title="Twilio SMS" enabled={credentialStatus.twilioEnabled} label="Twilio" intent="saveTwilio" saved={actionData?.ok && actionData.savedSection === "Twilio"}><TextField label="Account SID" name="twilioAccountSid" value={credentials.twilioAccountSid} onChange={setCredential("twilioAccountSid")} autoComplete="off" /><TextField label="Auth token" name="twilioAuthToken" value={credentials.twilioAuthToken} onChange={setCredential("twilioAuthToken")} type="password" autoComplete="off" /><TextField label="From number" name="twilioFromNumber" value={credentials.twilioFromNumber} onChange={setCredential("twilioFromNumber")} autoComplete="off" /></ApiCredentialForm><Divider /><ApiCredentialForm title="Resend Email" enabled={credentialStatus.resendEnabled} label="Resend" intent="saveResend" saved={actionData?.ok && actionData.savedSection === "Resend"}><TextField label="Resend API key" name="resendApiKey" value={credentials.resendApiKey} onChange={setCredential("resendApiKey")} type="password" autoComplete="off" /><TextField label="From email" name="resendFromEmail" value={credentials.resendFromEmail} onChange={setCredential("resendFromEmail")} type="email" autoComplete="off" /></ApiCredentialForm></BlockStack></LegacyCard></Layout.Section> : null}

  {activeTab === "tracking" ? <Layout.Section><BlockStack gap="400"><CustomerTrackingPreview settings={trackingSettings} /><LegacyCard title="Customer tracking screen" sectioned><Form method="post"><input type="hidden" name="intent" value="saveCustomerTracking" /><BlockStack gap="400"><Text as="p" variant="bodyMd" tone="subdued">Control the branded customer tracking page. The core tracking layout stays protected, but the wording, contact details, logo, progress tracker and optional custom footer can be edited.</Text>{actionData?.ok && actionData.savedSection === "Customer tracking screen" ? <Badge tone="success">Customer tracking screen saved</Badge> : null}<FormLayout><FormLayout.Group><TextField label="Company name" name="companyName" value={trackingSettings.companyName} onChange={setTracking("companyName")} autoComplete="off" /><TextField label="Brand colour" name="primaryColour" value={trackingSettings.primaryColour} onChange={setTracking("primaryColour")} autoComplete="off" helpText="Use a hex colour, for example #509AE6." /></FormLayout.Group><TextField label="Logo URL" name="logoUrl" value={trackingSettings.logoUrl} onChange={setTracking("logoUrl")} autoComplete="off" helpText="Optional. Leave blank to use the company name instead." /><FormLayout.Group><TextField label="Support phone" name="supportPhone" value={trackingSettings.supportPhone} onChange={setTracking("supportPhone")} autoComplete="off" /><TextField label="Support email" name="supportEmail" value={trackingSettings.supportEmail} onChange={setTracking("supportEmail")} type="email" autoComplete="off" /></FormLayout.Group><Divider /><Text as="h3" variant="headingMd">Page headings</Text><TextField label="Planned delivery heading" name="heroPlannedTitle" value={trackingSettings.heroPlannedTitle} onChange={setTracking("heroPlannedTitle")} autoComplete="off" /><TextField label="Out for delivery heading" name="heroOutForDeliveryTitle" value={trackingSettings.heroOutForDeliveryTitle} onChange={setTracking("heroOutForDeliveryTitle")} autoComplete="off" /><TextField label="Delivered heading" name="heroDeliveredTitle" value={trackingSettings.heroDeliveredTitle} onChange={setTracking("heroDeliveredTitle")} autoComplete="off" /><TextField label="Attempted delivery heading" name="heroAttemptedTitle" value={trackingSettings.heroAttemptedTitle} onChange={setTracking("heroAttemptedTitle")} autoComplete="off" /><Divider /><Text as="h3" variant="headingMd">Customer messages</Text><TextField label="Out for delivery message" name="outForDeliveryMessage" value={trackingSettings.outForDeliveryMessage} onChange={setTracking("outForDeliveryMessage")} multiline={2} autoComplete="off" /><TextField label="Not next yet message" name="notNextMessage" value={trackingSettings.notNextMessage} onChange={setTracking("notNextMessage")} multiline={2} autoComplete="off" /><TextField label="Delivered message" name="deliveredMessage" value={trackingSettings.deliveredMessage} onChange={setTracking("deliveredMessage")} multiline={2} autoComplete="off" /><TextField label="Attempted delivery message" name="attemptedMessage" value={trackingSettings.attemptedMessage} onChange={setTracking("attemptedMessage")} multiline={2} autoComplete="off" /><TextField label="Room of choice text" name="roomOfChoiceText" value={trackingSettings.roomOfChoiceText} onChange={setTracking("roomOfChoiceText")} multiline={2} autoComplete="off" /><Divider /><Text as="h3" variant="headingMd">Progress tracker design</Text><FormLayout.Group><TextField label="Progress line colour" name="progressLineColour" value={trackingSettings.progressLineColour} onChange={setTracking("progressLineColour")} autoComplete="off" /><TextField label="Van label" name="vanLabel" value={trackingSettings.vanLabel} onChange={setTracking("vanLabel")} autoComplete="off" /></FormLayout.Group><FormLayout.Group><TextField label="Van background colour" name="vanBackgroundColour" value={trackingSettings.vanBackgroundColour} onChange={setTracking("vanBackgroundColour")} autoComplete="off" /><TextField label="Van text colour" name="vanTextColour" value={trackingSettings.vanTextColour} onChange={setTracking("vanTextColour")} autoComplete="off" /></FormLayout.Group><FormLayout.Group><TextField label="End point label" name="homeLabel" value={trackingSettings.homeLabel} onChange={setTracking("homeLabel")} autoComplete="off" /><TextField label="End point background colour" name="homeBackgroundColour" value={trackingSettings.homeBackgroundColour} onChange={setTracking("homeBackgroundColour")} autoComplete="off" /></FormLayout.Group><FormLayout.Group><TextField label="End point border colour" name="homeBorderColour" value={trackingSettings.homeBorderColour} onChange={setTracking("homeBorderColour")} autoComplete="off" /><TextField label="End point text colour" name="homeTextColour" value={trackingSettings.homeTextColour} onChange={setTracking("homeTextColour")} autoComplete="off" /></FormLayout.Group><Divider /><Text as="h3" variant="headingMd">Preview products</Text><Text as="p" variant="bodySm" tone="subdued">These are only used inside the settings preview. The live page pulls the actual customer order from Shopify.</Text><TextField label="Preview product 1" name="previewItemOne" value={trackingSettings.previewItemOne} onChange={setTracking("previewItemOne")} autoComplete="off" /><TextField label="Preview product 2" name="previewItemTwo" value={trackingSettings.previewItemTwo} onChange={setTracking("previewItemTwo")} autoComplete="off" /><TextField label="Preview product 3" name="previewItemThree" value={trackingSettings.previewItemThree} onChange={setTracking("previewItemThree")} autoComplete="off" /><Divider /><Text as="h3" variant="headingMd">Optional custom code</Text><TextField label="Custom HTML / Liquid / JavaScript" name="customFooterHtml" value={trackingSettings.customFooterHtml} onChange={setTracking("customFooterHtml")} multiline={5} autoComplete="off" helpText="Shown at the bottom of the customer tracking page. Use this for extra footer content or merchant specific code." /><TextField label="Custom CSS" name="customCss" value={trackingSettings.customCss} onChange={setTracking("customCss")} multiline={5} autoComplete="off" helpText="Optional styling for the tracking page only. Keep CSS scoped to your custom block or .bpd-track-page." /><Button submit variant="primary">Save customer tracking screen</Button></FormLayout></BlockStack></Form></LegacyCard></BlockStack></Layout.Section> : null}

  {activeTab === "maps" ? <Layout.Section><LegacyCard title="Maps and address lookup" sectioned><BlockStack gap="500"><ApiCredentialForm title="TomTom" enabled={credentialStatus.tomtomEnabled} label="TomTom" intent="saveTomTom" saved={actionData?.ok && actionData.savedSection === "TomTom"}><TextField label="TomTom API key" name="tomtomApiKey" value={credentials.tomtomApiKey} onChange={setCredential("tomtomApiKey")} type="password" autoComplete="off" helpText="Used for live maps, route markers and address matching." /></ApiCredentialForm><Divider /><ApiCredentialForm title="RouteXL" enabled={credentialStatus.routexlEnabled} label="RouteXL" intent="saveRouteXL" saved={actionData?.ok && actionData.savedSection === "RouteXL"}><FormLayout.Group><TextField label="RouteXL username" name="routexlUsername" value={credentials.routexlUsername} onChange={setCredential("routexlUsername")} autoComplete="off" /><TextField label="RouteXL password" name="routexlPassword" value={credentials.routexlPassword} onChange={setCredential("routexlPassword")} type="password" autoComplete="off" /></FormLayout.Group></ApiCredentialForm><Divider /><ApiCredentialForm title="getAddress.io" enabled={credentialStatus.getAddressEnabled} label="getAddress.io" intent="saveGetAddress" saved={actionData?.ok && actionData.savedSection === "getAddress.io"}><TextField label="getAddress.io API key" name="getAddressApiKey" value={credentials.getAddressApiKey} onChange={setCredential("getAddressApiKey")} type="password" autoComplete="off" helpText="Stored for address lookup support." /></ApiCredentialForm></BlockStack></LegacyCard></Layout.Section> : null}

  {activeTab === "storage" ? <Layout.Section><LegacyCard title="Storage and developer" sectioned><BlockStack gap="500"><ApiCredentialForm title="Proof Photo Storage" enabled={credentialStatus.proofPhotoStorageEnabled} label="Photo storage" intent="saveProofPhotoStorage" saved={actionData?.ok && actionData.savedSection === "Proof photo storage"}><TextField label="Storage endpoint" name="proofPhotoStorageEndpoint" value={credentials.proofPhotoStorageEndpoint} onChange={setCredential("proofPhotoStorageEndpoint")} autoComplete="off" /><FormLayout.Group><TextField label="Region" name="proofPhotoStorageRegion" value={credentials.proofPhotoStorageRegion} onChange={setCredential("proofPhotoStorageRegion")} autoComplete="off" /><TextField label="Bucket" name="proofPhotoStorageBucket" value={credentials.proofPhotoStorageBucket} onChange={setCredential("proofPhotoStorageBucket")} autoComplete="off" /></FormLayout.Group><TextField label="Access key ID" name="proofPhotoStorageAccessKeyId" value={credentials.proofPhotoStorageAccessKeyId} onChange={setCredential("proofPhotoStorageAccessKeyId")} autoComplete="off" /><TextField label="Secret access key" name="proofPhotoStorageSecretAccessKey" value={credentials.proofPhotoStorageSecretAccessKey} onChange={setCredential("proofPhotoStorageSecretAccessKey")} type="password" autoComplete="off" /><TextField label="Public base URL" name="proofPhotoPublicBaseUrl" value={credentials.proofPhotoPublicBaseUrl} onChange={setCredential("proofPhotoPublicBaseUrl")} autoComplete="off" /></ApiCredentialForm><Divider /><ApiCredentialForm title="Customer Tracking URL" enabled={credentialStatus.shopPublicUrlEnabled} label="Tracking URL" intent="saveTrackingUrl" saved={actionData?.ok && actionData.savedSection === "Tracking URL"}><TextField label="Public shop URL" name="shopPublicUrl" value={credentials.shopPublicUrl} onChange={setCredential("shopPublicUrl")} autoComplete="off" helpText="Used when customer SMS and email messages include their tracking link." /></ApiCredentialForm></BlockStack></LegacyCard></Layout.Section> : null}</Layout></Page>;
}
