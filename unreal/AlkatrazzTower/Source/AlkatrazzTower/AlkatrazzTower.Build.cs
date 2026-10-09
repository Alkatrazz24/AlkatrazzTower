// Module editeur du plugin Alkatrazz Tower (Win64, editeur seulement).

using UnrealBuildTool;

public class AlkatrazzTower : ModuleRules
{
	public AlkatrazzTower(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"CoreUObject",
			"Engine",
			"UnrealEd",
			"AssetRegistry",
			"Slate",
			"SlateCore",
			"ToolMenus",
			"WorkspaceMenuStructure",
			"WebBrowser",
			"HTTP",
			"Json",
		});

		// Live Coding n'existe que sur Win64 x64 hors Shipping/Test : meme garde que l'editeur.
		if (Target.bWithLiveCoding)
		{
			PrivateDependencyModuleNames.Add("LiveCoding");
		}
	}
}
