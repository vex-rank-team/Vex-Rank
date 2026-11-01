#!/usr/bin/env python3
"""Generate MakapakaScout.xcodeproj.

The simulator build uses swiftc directly, which is enough to run but cannot
be code signed or installed on a phone. Signing needs a real project so that
xcodebuild can talk to the developer account and provision the bundle id, so
the project is generated from the sources on disk rather than kept by hand and
left to drift.
"""
import os, re, uuid, pathlib

ROOT = pathlib.Path(__file__).parent
PROJECT = ROOT / "MakapakaScout.xcodeproj"
BUNDLE_ID = "com.vexrank.app"
TEAM = "JJRCKVACCR"

def oid(seed):
    return uuid.uuid5(uuid.NAMESPACE_URL, seed).hex[:24].upper()

# Only the app's own sources. VEXRankKit comes in as the local Swift package
# it already is, so the module the app imports actually exists and the package
# stays the single definition of the kit rather than being copied in here.
sources = sorted([p for p in (ROOT / "App").glob("*.swift")])
assets = ROOT / "App/Assets.xcassets"

file_refs, build_files, group_children = [], [], []
for path in sources:
    rel = path.relative_to(ROOT).as_posix()
    fid, bid = oid("file:" + rel), oid("build:" + rel)
    file_refs.append(f'\t\t{fid} /* {path.name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = "{path.name}"; path = "{rel}"; sourceTree = "<group>"; }};')
    build_files.append(f'\t\t{bid} /* {path.name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fid} /* {path.name} */; }};')
    group_children.append(f'\t\t\t\t{fid} /* {path.name} */,')

resource_phase_files, resource_refs = [], []
if assets.exists():
    rel = assets.relative_to(ROOT).as_posix()
    fid, bid = oid("file:assets"), oid("build:assets")
    file_refs.append(f'\t\t{fid} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; name = Assets.xcassets; path = "{rel}"; sourceTree = "<group>"; }};')
    build_files.append(f'\t\t{bid} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {fid} /* Assets.xcassets */; }};')
    group_children.append(f'\t\t\t\t{fid} /* Assets.xcassets */,')
    resource_refs.append(f'\t\t\t\t{bid} /* Assets.xcassets in Resources */,')

ids = {k: oid(k) for k in ["project","target","group","productsGroup","product","sources","resources","frameworks",
                            "cfgListProject","cfgListTarget","debugProject","releaseProject","debugTarget","releaseTarget",
                            "packageRef","productDep","packageBuildFile"]}

build_files.append(f'\t\t{ids["packageBuildFile"]} /* VEXRankKit in Frameworks */ = {{isa = PBXBuildFile; productRef = {ids["productDep"]} /* VEXRankKit */; }};')
# Xcode also lists the package folder itself in the navigator; without it the
# local package is declared but never located.
file_refs.append(f'\t\t{oid("file:package")} /* VEXRankKit */ = {{isa = PBXFileReference; lastKnownFileType = wrapper; name = VEXRankKit; path = VEXRankKit; sourceTree = "<group>"; }};')
group_children.append(f'\t\t\t\t{oid("file:package")} /* VEXRankKit */,')
# Build settings that live in a file, so a local-only one (the events.vex
# token, in the git-ignored Secrets.xcconfig) can be included without editing
# the project. See App/Config/Base.xcconfig.
base_config = oid("file:App/Config/Base.xcconfig")
file_refs.append(f'\t\t{base_config} /* Base.xcconfig */ = {{isa = PBXFileReference; lastKnownFileType = text.xcconfig; name = Base.xcconfig; path = "App/Config/Base.xcconfig"; sourceTree = "<group>"; }};')
group_children.append(f'\t\t\t\t{base_config} /* Base.xcconfig */,')

SETTINGS_TARGET = f'''
\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 4;
\t\t\t\tDEVELOPMENT_TEAM = {TEAM};
\t\t\t\tGENERATE_INFOPLIST_FILE = YES;
\t\t\t\tINFOPLIST_FILE = App/Info.plist;
\t\t\t\tINFOPLIST_KEY_CFBundleDisplayName = "Makapaka Scout";
\t\t\t\tINFOPLIST_KEY_CFBundleName = "Makapaka Scout";\n\t\t\t\tINFOPLIST_KEY_UILaunchScreen_Generation = YES;\n\t\t\t\tINFOPLIST_KEY_UILaunchScreen_BackgroundColor = LaunchBackground;
\t\t\t\tINFOPLIST_KEY_UISupportedInterfaceOrientations = UIInterfaceOrientationPortrait;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = {BUNDLE_ID};
\t\t\t\tPRODUCT_NAME = MakapakaScout;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = 1;
'''

pbx = f'''// !$*UTF8*$!
{{
\tarchiveVersion = 1;
\tclasses = {{}};
\tobjectVersion = 60;
\tobjects = {{

/* Begin PBXBuildFile section */
{chr(10).join(build_files)}
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
{chr(10).join(file_refs)}
\t\t{ids["product"]} /* MakapakaScout.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = MakapakaScout.app; sourceTree = BUILT_PRODUCTS_DIR; }};
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
\t\t{ids["frameworks"]} = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
\t\t{ids["group"]} = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
{chr(10).join(group_children)}
\t\t\t\t{ids["productsGroup"]} /* Products */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{ids["productsGroup"]} /* Products */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = ( {ids["product"]} /* MakapakaScout.app */, );
\t\t\tname = Products;
\t\t\tsourceTree = "<group>";
\t\t}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
\t\t{ids["target"]} /* MakapakaScout */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {ids["cfgListTarget"]};
\t\t\tbuildPhases = ( {ids["sources"]}, {ids["frameworks"]}, {ids["resources"]}, );
\t\t\tbuildRules = ();
\t\t\tdependencies = ();
\t\t\tname = MakapakaScout;
\t\t\tproductName = MakapakaScout;
\t\t\tproductReference = {ids["product"]} /* MakapakaScout.app */;
\t\t\tpackageProductDependencies = ( {ids["productDep"]} /* VEXRankKit */, );\n\t\t\tproductType = "com.apple.product-type.application";
\t\t}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
\t\t{ids["project"]} = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 1610;
\t\t\t\tLastUpgradeCheck = 1610;
\t\t\t\tTargetAttributes = {{ {ids["target"]} = {{ CreatedOnToolsVersion = 16.1; }}; }};
\t\t\t}};
\t\t\tbuildConfigurationList = {ids["cfgListProject"]};
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = ( en, Base, );
\t\t\tmainGroup = {ids["group"]};
\t\t\tproductRefGroup = {ids["productsGroup"]};
\t\t\tpackageReferences = ( {ids["packageRef"]} /* XCLocalSwiftPackageReference "VEXRankKit" */, );\n\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = ( {ids["target"]} /* MakapakaScout */, );
\t\t}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
\t\t{ids["resources"]} = {{
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
{chr(10).join(resource_refs)}
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
\t\t{ids["sources"]} = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
{chr(10).join('\t\t\t\t' + b.split('/*')[0].strip() + ' ,' for b in build_files if 'in Sources' in b)}
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
\t\t{ids["debugProject"]} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;
\t\t\t\tENABLE_TESTABILITY = YES;
\t\t\t\tGCC_OPTIMIZATION_LEVEL = 0;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;
\t\t\t\tONLY_ACTIVE_ARCH = YES;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";
\t\t\t}};
\t\t\tname = Debug;
\t\t}};
\t\t{ids["releaseProject"]} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tDEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
\t\t\t\tENABLE_NS_ASSERTIONS = NO;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;
\t\t\t\tVALIDATE_PRODUCT = YES;
\t\t\t}};
\t\t\tname = Release;
\t\t}};
\t\t{ids["debugTarget"]} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbaseConfigurationReference = {base_config} /* Base.xcconfig */;
\t\t\tbuildSettings = {{{SETTINGS_TARGET}\t\t\t}};
\t\t\tname = Debug;
\t\t}};
\t\t{ids["releaseTarget"]} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbaseConfigurationReference = {base_config} /* Base.xcconfig */;
\t\t\tbuildSettings = {{{SETTINGS_TARGET}\t\t\t}};
\t\t\tname = Release;
\t\t}};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
\t\t{ids["cfgListProject"]} = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = ( {ids["debugProject"]} /* Debug */, {ids["releaseProject"]} /* Release */, );
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
\t\t{ids["cfgListTarget"]} = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = ( {ids["debugTarget"]} /* Debug */, {ids["releaseTarget"]} /* Release */, );
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
/* End XCConfigurationList section */

/* Begin XCLocalSwiftPackageReference section */
		{ids["packageRef"]} /* XCLocalSwiftPackageReference "VEXRankKit" */ = {{
			isa = XCLocalSwiftPackageReference;
			relativePath = VEXRankKit;
		}};
/* End XCLocalSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
		{ids["productDep"]} /* VEXRankKit */ = {{
			isa = XCSwiftPackageProductDependency;
			productName = VEXRankKit;
		}};
/* End XCSwiftPackageProductDependency section */
\t}};
\trootObject = {ids["project"]};
}}
'''

PROJECT.mkdir(exist_ok=True)
(PROJECT / "project.pbxproj").write_text(pbx)
print(f"wrote {PROJECT}/project.pbxproj with {len(sources)} sources")
