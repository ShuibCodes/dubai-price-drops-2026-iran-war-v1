import WhatsAppUploader from "./WhatsAppUploader";
import CrmCsvUploader from "./CrmCsvUploader";

/**
 * @param {{ type: "whatsapp" | "crm", onBack?: () => void, onAddMoreData?: () => void }} props
 */
export default function KbUploader({ type, onBack, onAddMoreData }) {
  if (type === "whatsapp") {
    return (
      <WhatsAppUploader onBack={onBack} onAddMoreData={onAddMoreData} />
    );
  }
  return <CrmCsvUploader onBack={onBack} onAddMoreData={onAddMoreData} />;
}
