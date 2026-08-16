import ClassicTemplate from "./templates/ClassicTemplate";
import MinimalImageTemplate from "./templates/MinimalImageTemplate";
import MinimalTemplate from "./templates/MinimalTemplate";
import ModernTemplate from "./templates/ModernTemplate";

const ResumePreview = ({ data, template, accentColor, classes = "" }) => {
  const renderTemplate = () => {
    const templateProps = { data, accentColor };

    switch (template) {
      case "modern":
        return <ModernTemplate {...templateProps} />;
      case "minimal":
        return <MinimalTemplate {...templateProps} />;
      case "minimal-image":
        return <MinimalImageTemplate {...templateProps} />;
      default:
        return <ClassicTemplate {...templateProps} />;
    }
  };

  return (
    <div className="w-full bg-gray-100">
      <div
        id="resume-preview"
        className={`border border-gray-200 print:shadow-none print:border-none ${classes}`}
      >
        {renderTemplate()}
      </div>

      <style jsx>
        {`
          @page {
            size: letter;
            margin: 0;
          }
          @media print {
            html,
            body {
              width: 8.5in;
              height: 11in;
              overflow: hidden;
            }
            body * {
              visibility: hidden;
            }
            #resume-preview,
            #resume-preview * {
              visibility: visible;
            }
            #resume-preview {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              height: auto;
              margin: 0;
              padding: 0;
              box-shadow: none !important;
              border: none !important;
            }
          }
        `}
      </style>
    </div>
  );
};

export default ResumePreview;
