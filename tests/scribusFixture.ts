export const scribusFixture = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.6.7">
  <DOCUMENT TITLE="Scribus handoff" PAGEWIDTH="612" PAGEHEIGHT="792" BOOK="1" BORDERLEFT="36" BleedTop="9">
    <COLOR NAME="Blue Ink" SPACE="CMYK" C="100" M="28" Y="0" K="3"/>
    <CHARSTYLE CNAME="Body face" DefaultStyle="1" FONT="Georgia Regular" FONTSIZE="12" FCOLOR="Black"/>
    <CHARSTYLE CNAME="Emphasis" CPARENT="Body face" FONT="Georgia Bold"/>
    <STYLE NAME="Body" DefaultStyle="1" CPARENT="Body face" LINESP="15"/>
    <LAYERS NUMMER="0" LEVEL="0" NAME="Editorial" DRUCKEN="1" EDIT="1"/>
    <MASTERPAGE NUM="0" NAM="Running header" PAGEXPOS="100" PAGEYPOS="20"/>
    <PAGE NUM="0" PAGEXPOS="100" PAGEYPOS="20" MNAM="Running header"/>
    <PAGE NUM="1" PAGEXPOS="750" PAGEYPOS="20" MNAM="Running header"/>
    <MASTEROBJECT OwnPage="0" OnMasterPage="Running header" PTYPE="5" XPOS="136" YPOS="47" WIDTH="530" HEIGHT="0" PWIDTH="1" PCOLOR2="Blue Ink"/>
    <PAGEOBJECT OwnPage="0" ItemID="20" NEXTITEM="30" PTYPE="4" XPOS="136" YPOS="56" WIDTH="530" HEIGHT="40" LAYER="0">
      <StoryText><DefaultStyle PARENT="Body"/><ITEXT CH="Opening &amp; proof "/><ITEXT CH="copy" CPARENT="Emphasis"/><para/><ITEXT CH="Second paragraph"/><trail/></StoryText>
    </PAGEOBJECT>
    <PAGEOBJECT OwnPage="1" ItemID="30" NEXTITEM="-1" PTYPE="4" XPOS="786" YPOS="56" WIDTH="530" HEIGHT="530" LAYER="0"><StoryText><DefaultStyle/></StoryText></PAGEOBJECT>
    <PAGEOBJECT OwnPage="0" PTYPE="12" XPOS="180" YPOS="200" WIDTH="100" HEIGHT="80" groupWidth="100" groupHeight="80">
      <PAGEOBJECT OwnPage="0" PTYPE="6" FRTYPE="0" XPOS="180" YPOS="200" WIDTH="100" HEIGHT="80" PCOLOR="Blue Ink"/>
      <PAGEOBJECT OwnPage="0" PTYPE="6" FRTYPE="3" XPOS="180" YPOS="200" WIDTH="100" HEIGHT="80" PCOLOR="Black" path="M0 0 L100 0 C100 20 65 80 0 80 L0 0 Z"/>
    </PAGEOBJECT>
    <PAGEOBJECT OwnPage="0" PTYPE="2" XPOS="136" YPOS="400" WIDTH="150" HEIGHT="120" PFILE="https://example.invalid/external.jpg"/>
    <PAGEOBJECT OwnPage="0" PTYPE="16" XPOS="136" YPOS="600" WIDTH="150" HEIGHT="120"/>
  </DOCUMENT>
</SCRIBUSUTF8NEW>`;
