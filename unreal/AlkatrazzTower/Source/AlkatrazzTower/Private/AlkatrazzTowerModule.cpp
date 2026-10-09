// Plugin editeur Alkatrazz Tower.
//
// Ce que fait le module, toutes les secondes au plus :
//   - envoie a la tour l'etat de l'editeur (map, PIE, assets non sauvegardes, Live Coding) ;
//   - met une compilation Live Coding sous le verrou de build de la tour, comme celles des agents ;
//   - lit le fil de la tour et affiche une notification quand un agent attend une reponse, qu'un build
//     echoue, qu'un agent lance une compilation ou que la version est validee ;
//   - signale les assets ajoutes, renommes, supprimes ou sauvegardes (la carte se met a jour) ;
//   - previent quand on ouvre un asset qu'un agent vient de modifier.
// Il ajoute aussi un onglet "Alkatrazz Tower" (la page de la tour) et un bouton dans la barre d'outils.
//
// Tour eteinte : les requetes echouent en silence, l'editeur fonctionne exactement comme avant.

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"
#include "TowerClient.h"

#include <atomic>

#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Containers/Ticker.h"
#include "CoreGlobals.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Editor.h"
#include "Editor/EditorEngine.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "FileHelpers.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Commands/UIAction.h"
#include "Framework/Docking/TabManager.h"
#include "Framework/Notifications/NotificationManager.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformTime.h"
#include "Misc/App.h"
#include "Misc/CoreDelegates.h"
#include "Misc/EngineVersion.h"
#include "Misc/OutputDevice.h"
#include "Misc/OutputDeviceRedirector.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Misc/ScopeLock.h"
#include "SWebBrowser.h"
#include "Styling/AppStyle.h"
#include "Subsystems/AssetEditorSubsystem.h"
#include "Textures/SlateIcon.h"
#include "ToolMenus.h"
#include "UObject/ObjectSaveContext.h"
#include "UObject/Package.h"
#include "Widgets/Docking/SDockTab.h"
#include "Widgets/Notifications/SNotificationList.h"
#include "WorkspaceMenuStructure.h"
#include "WorkspaceMenuStructureModule.h"

#if WITH_LIVE_CODING
#include "ILiveCodingModule.h"
#endif

#define LOCTEXT_NAMESPACE "AlkatrazzTower"

namespace
{
	const FName TowerTabName(TEXT("AlkatrazzTower"));
	const TCHAR* TowerIcon = TEXT("Icons.Server");

	// Retient les lignes LogLiveCoding pendant une compilation, pour dire a la tour si elle a echoue.
	// Le journal peut ecrire depuis n'importe quel thread : tout passe par le verrou.
	class FLiveCodingLogCapture : public FOutputDevice
	{
	public:
		void Start()
		{
			FScopeLock Lock(&Mutex);
			bCapturing = true;
			bSawError = false;
			bSawSuccess = false;
			ErrorLines.Reset();
		}

		void Stop(bool& bOutError, bool& bOutSuccess, TArray<FString>& OutErrors)
		{
			FScopeLock Lock(&Mutex);
			bCapturing = false;
			bOutError = bSawError;
			bOutSuccess = bSawSuccess;
			OutErrors = ErrorLines;
		}

		virtual void Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category) override
		{
			static const FName LiveCodingCategory(TEXT("LogLiveCoding"));
			if (Category != LiveCodingCategory || V == nullptr)
			{
				return;
			}
			FScopeLock Lock(&Mutex);
			if (!bCapturing)
			{
				return;
			}
			const FString Line(V);
			const bool bError = Verbosity <= ELogVerbosity::Error
				|| Line.Contains(TEXT("failed"), ESearchCase::IgnoreCase)
				|| Line.Contains(TEXT(": error "), ESearchCase::IgnoreCase);
			if (bError)
			{
				bSawError = true;
				if (ErrorLines.Num() < 5)
				{
					ErrorLines.Add(Line.Left(300));
				}
			}
			if (Line.Contains(TEXT("succeeded"), ESearchCase::IgnoreCase))
			{
				bSawSuccess = true;
			}
		}

		virtual bool CanBeUsedOnAnyThread() const override { return true; }

	private:
		FCriticalSection Mutex;
		bool bCapturing = false;
		bool bSawError = false;
		bool bSawSuccess = false;
		TArray<FString> ErrorLines;
	};
}

class FAlkatrazzTowerModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
	bool Tick(float DeltaTime);
	void RegisterMenus();
	TSharedRef<SDockTab> SpawnTab(const FSpawnTabArgs& Args);
	void OpenTab();
	void Notify(const FText& Text, SNotificationItem::ECompletionState State, bool bLinkToTower);

	void PushEditorState(double Now);
	void PollFeed();
	void HandleFeed(const TSharedPtr<FJsonObject>& Feed);
	void WatchLiveCoding(double Now);
	void ReleaseLiveCoding();
	void FlushAssetChanges(double Now);
	void OnAssetOpened(UObject* Asset, IAssetEditorInstance* Editor);

	FString ProjectName() const { return FApp::GetProjectName(); }
	FString EditorSessionId() const { return FString(TEXT("editor:")) + ProjectName(); }

	// Jeton de vie : les rappels HTTP qui arrivent apres l'arret du module ne font rien.
	TSharedPtr<bool> Alive;
	bool bStarted = false;

	FTSTicker::FDelegateHandle TickHandle;
	FDelegateHandle AssetAddedHandle;
	FDelegateHandle AssetRemovedHandle;
	FDelegateHandle AssetRenamedHandle;
	FDelegateHandle PackageSavedHandle;
	FDelegateHandle AssetOpenedHandle;
	FDelegateHandle PatchCompleteHandle;

	double LastStateCheck = 0.0;
	double LastStatePush = 0.0;
	double LastFeedPoll = 0.0;
	double LastAssetFlush = 0.0;
	double LastHeartbeat = 0.0;
	FString LastStateJson;
	bool bStateRequestInFlight = false;
	bool bFeedRequestInFlight = false;

	// Les evenements du registre d'assets peuvent arriver sur n'importe quel thread.
	std::atomic<bool> bAssetsChanged{ false };
	FCriticalSection SavedMutex;
	FString LastSavedPackage;

	// Live Coding sous le verrou
	TUniquePtr<FLiveCodingLogCapture> LiveCodingLog;
	std::atomic<bool> bPatchApplied{ false };
	bool bWasCompiling = false;
	FString LiveCodingTicket;
	double CompileStartedAt = 0.0;

	// Ce qu'on sait deja du fil, pour ne notifier que les changements.
	bool bFeedPrimed = false;
	TSet<FString> WaitingAgents;
	FString LastBuildId;
	FString LastLockSession;
	bool bVersionWon = false;
};

IMPLEMENT_MODULE(FAlkatrazzTowerModule, AlkatrazzTower)

// ---------------------------------------------------------------------------------------------------
// Demarrage et arret

void FAlkatrazzTowerModule::StartupModule()
{
	// UnrealEditor-Cmd (suites de tests, scripts Python, commandlets) charge aussi les modules
	// editeur : il ne doit ni ecraser l'etat du vrai editeur ni prendre le verrou de compilation.
	if (IsRunningCommandlet() || FApp::IsUnattended() || !FApp::CanEverRender())
	{
		UE_LOG(LogAlkatrazzTower, Log, TEXT("Alkatrazz Tower : editeur sans fenetre, plugin en sommeil."));
		return;
	}
	bStarted = true;
	Alive = MakeShared<bool>(true);

	FGlobalTabmanager::Get()->RegisterNomadTabSpawner(TowerTabName, FOnSpawnTab::CreateRaw(this, &FAlkatrazzTowerModule::SpawnTab))
		.SetDisplayName(LOCTEXT("TabTitle", "Alkatrazz Tower"))
		.SetTooltipText(LOCTEXT("TabTooltip", "Agents Claude Code, compilation, version a sortir et carte du projet."))
		.SetGroup(WorkspaceMenu::GetMenuStructure().GetToolsCategory())
		.SetIcon(FSlateIcon(FAppStyle::GetAppStyleSetName(), TowerIcon));

	UToolMenus::RegisterStartupCallback(FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FAlkatrazzTowerModule::RegisterMenus));

	IAssetRegistry& AssetRegistry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(AssetRegistryConstants::ModuleName).Get();
	AssetAddedHandle = AssetRegistry.OnAssetAdded().AddLambda([this](const FAssetData&) { bAssetsChanged = true; });
	AssetRemovedHandle = AssetRegistry.OnAssetRemoved().AddLambda([this](const FAssetData&) { bAssetsChanged = true; });
	AssetRenamedHandle = AssetRegistry.OnAssetRenamed().AddLambda([this](const FAssetData&, const FString&) { bAssetsChanged = true; });

	PackageSavedHandle = UPackage::PackageSavedWithContextEvent.AddLambda(
		[this](const FString& PackageFileName, UPackage* Package, FObjectPostSaveContext Context)
		{
			if (Context.IsCooking() || Context.IsProceduralSave() || Context.IsFromAutoSave() || !Context.SaveSucceeded())
			{
				return;
			}
			if (Package)
			{
				FScopeLock Lock(&SavedMutex);
				LastSavedPackage = Package->GetName();
			}
			bAssetsChanged = true;
		});

	if (GEditor)
	{
		if (UAssetEditorSubsystem* AssetEditors = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>())
		{
			AssetOpenedHandle = AssetEditors->OnAssetOpenedInEditor().AddRaw(this, &FAlkatrazzTowerModule::OnAssetOpened);
		}
	}

	LiveCodingLog = MakeUnique<FLiveCodingLogCapture>();
	if (GLog)
	{
		GLog->AddOutputDevice(LiveCodingLog.Get());
	}

	TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FAlkatrazzTowerModule::Tick), 1.0f);
	UE_LOG(LogAlkatrazzTower, Log, TEXT("Alkatrazz Tower : plugin demarre pour %s, tour attendue sur %s"), *ProjectName(), *TowerClient::BaseUrl());
}

void FAlkatrazzTowerModule::ShutdownModule()
{
	if (!bStarted)
	{
		return;
	}
	Alive.Reset();
	FTSTicker::RemoveTicker(TickHandle);

	// Une compilation Live Coding en cours ne doit pas laisser le verrou a la tour.
	ReleaseLiveCoding();

	if (IAssetRegistry* AssetRegistry = IAssetRegistry::Get())
	{
		AssetRegistry->OnAssetAdded().Remove(AssetAddedHandle);
		AssetRegistry->OnAssetRemoved().Remove(AssetRemovedHandle);
		AssetRegistry->OnAssetRenamed().Remove(AssetRenamedHandle);
	}
	UPackage::PackageSavedWithContextEvent.Remove(PackageSavedHandle);

	if (GEditor)
	{
		if (UAssetEditorSubsystem* AssetEditors = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>())
		{
			AssetEditors->OnAssetOpenedInEditor().Remove(AssetOpenedHandle);
		}
	}

#if WITH_LIVE_CODING
	if (ILiveCodingModule* LiveCoding = FModuleManager::GetModulePtr<ILiveCodingModule>(LIVE_CODING_MODULE_NAME))
	{
		LiveCoding->GetOnPatchCompleteDelegate().Remove(PatchCompleteHandle);
	}
#endif

	if (GLog && LiveCodingLog.IsValid())
	{
		GLog->RemoveOutputDevice(LiveCodingLog.Get());
	}
	LiveCodingLog.Reset();

	UToolMenus::UnRegisterStartupCallback(this);
	UToolMenus::UnregisterOwner(this);

	if (FSlateApplication::IsInitialized())
	{
		FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(TowerTabName);
	}
}

// ---------------------------------------------------------------------------------------------------
// Onglet, bouton, notifications

void FAlkatrazzTowerModule::RegisterMenus()
{
	FToolMenuOwnerScoped OwnerScoped(this);
	if (UToolMenu* Toolbar = UToolMenus::Get()->ExtendMenu("LevelEditor.LevelEditorToolBar.PlayToolBar"))
	{
		FToolMenuSection& Section = Toolbar->FindOrAddSection("PluginTools");
		Section.AddEntry(FToolMenuEntry::InitToolBarButton(
			"AlkatrazzTowerButton",
			FUIAction(FExecuteAction::CreateRaw(this, &FAlkatrazzTowerModule::OpenTab)),
			LOCTEXT("ToolbarLabel", "Tour"),
			LOCTEXT("ToolbarTooltip", "Ouvrir Alkatrazz Tower : agents, compilation, version et carte du projet."),
			FSlateIcon(FAppStyle::GetAppStyleSetName(), TowerIcon)));
	}
}

TSharedRef<SDockTab> FAlkatrazzTowerModule::SpawnTab(const FSpawnTabArgs& Args)
{
	return SNew(SDockTab)
		.TabRole(ETabRole::NomadTab)
		[
			SNew(SWebBrowser)
			.InitialURL(TowerClient::BaseUrl())
			.ShowControls(false)
			.ShowAddressBar(false)
			.ShowErrorMessage(true)
		];
}

void FAlkatrazzTowerModule::OpenTab()
{
	FGlobalTabmanager::Get()->TryInvokeTab(FTabId(TowerTabName));
}

void FAlkatrazzTowerModule::Notify(const FText& Text, SNotificationItem::ECompletionState State, bool bLinkToTower)
{
	if (!FSlateApplication::IsInitialized())
	{
		return;
	}
	FNotificationInfo Info(Text);
	Info.ExpireDuration = 8.0f;
	Info.bFireAndForget = true;
	if (bLinkToTower)
	{
		TWeakPtr<bool> WeakAlive = Alive;
		Info.Hyperlink = FSimpleDelegate::CreateLambda([this, WeakAlive]()
		{
			if (WeakAlive.IsValid())
			{
				OpenTab();
			}
		});
		Info.HyperlinkText = LOCTEXT("OpenTower", "Ouvrir la tour");
	}
	TSharedPtr<SNotificationItem> Item = FSlateNotificationManager::Get().AddNotification(Info);
	if (Item.IsValid())
	{
		Item->SetCompletionState(State);
	}
}

// ---------------------------------------------------------------------------------------------------
// Boucle : une fois par seconde

bool FAlkatrazzTowerModule::Tick(float DeltaTime)
{
	const double Now = FPlatformTime::Seconds();
	WatchLiveCoding(Now);
	if (Now - LastStateCheck >= 2.0)
	{
		LastStateCheck = Now;
		PushEditorState(Now);
	}
	if (Now - LastFeedPoll >= 3.0)
	{
		LastFeedPoll = Now;
		PollFeed();
	}
	if (bAssetsChanged && Now - LastAssetFlush >= 3.0)
	{
		FlushAssetChanges(Now);
	}
	return true;
}

// ---------------------------------------------------------------------------------------------------
// Etat de l'editeur

void FAlkatrazzTowerModule::PushEditorState(double Now)
{
	if (bStateRequestInFlight)
	{
		return;
	}

	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("project"), ProjectName());
	Body->SetStringField(TEXT("uproject"), FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()));
	Body->SetStringField(TEXT("engine"), FEngineVersion::Current().ToString(EVersionComponent::Patch));
	Body->SetNumberField(TEXT("pid"), FPlatformProcess::GetCurrentProcessId());

	FString MapName;
	bool bPie = false;
	TArray<FString> OpenAssets;
	if (GEditor)
	{
		bPie = GEditor->IsPlaySessionInProgress();
		if (UWorld* World = GEditor->GetEditorWorldContext().World())
		{
			MapName = World->GetMapName();
		}
		if (UAssetEditorSubsystem* AssetEditors = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>())
		{
			for (UObject* Asset : AssetEditors->GetAllEditedAssets())
			{
				if (Asset && OpenAssets.Num() < 20)
				{
					OpenAssets.Add(Asset->GetPathName());
				}
			}
		}
	}
	Body->SetStringField(TEXT("map"), MapName);
	Body->SetBoolField(TEXT("pie"), bPie);

	TArray<UPackage*> DirtyContent;
	TArray<UPackage*> DirtyWorlds;
	FEditorFileUtils::GetDirtyContentPackages(DirtyContent);
	FEditorFileUtils::GetDirtyWorldPackages(DirtyWorlds);
	TArray<TSharedPtr<FJsonValue>> DirtyNames;
	for (UPackage* Package : DirtyContent)
	{
		if (Package && DirtyNames.Num() < 10)
		{
			DirtyNames.Add(MakeShared<FJsonValueString>(FPackageName::GetShortName(Package->GetName())));
		}
	}
	for (UPackage* Package : DirtyWorlds)
	{
		if (Package && DirtyNames.Num() < 10)
		{
			DirtyNames.Add(MakeShared<FJsonValueString>(FPackageName::GetShortName(Package->GetName())));
		}
	}
	Body->SetNumberField(TEXT("dirty"), DirtyContent.Num() + DirtyWorlds.Num());
	Body->SetArrayField(TEXT("dirtyNames"), DirtyNames);

	TArray<TSharedPtr<FJsonValue>> OpenValues;
	for (const FString& Path : OpenAssets)
	{
		OpenValues.Add(MakeShared<FJsonValueString>(Path));
	}
	Body->SetArrayField(TEXT("openAssets"), OpenValues);

	TSharedRef<FJsonObject> LiveCodingState = MakeShared<FJsonObject>();
#if WITH_LIVE_CODING
	ILiveCodingModule* LiveCoding = FModuleManager::GetModulePtr<ILiveCodingModule>(LIVE_CODING_MODULE_NAME);
	LiveCodingState->SetBoolField(TEXT("enabled"), LiveCoding && LiveCoding->IsEnabledForSession());
	LiveCodingState->SetBoolField(TEXT("compiling"), LiveCoding && LiveCoding->IsCompiling());
#else
	LiveCodingState->SetBoolField(TEXT("enabled"), false);
	LiveCodingState->SetBoolField(TEXT("compiling"), false);
#endif
	Body->SetObjectField(TEXT("liveCoding"), TSharedPtr<FJsonObject>(LiveCodingState));

	// On n'envoie que si quelque chose a change, ou toutes les 6 s pour dire "toujours la".
	const FString Json = TowerClient::ToJson(Body);
	if (Json == LastStateJson && Now - LastStatePush < 6.0)
	{
		return;
	}
	LastStateJson = Json;
	LastStatePush = Now;
	bStateRequestInFlight = true;
	TWeakPtr<bool> WeakAlive = Alive;
	TowerClient::Post(TEXT("/api/editor/state"), Body, [this, WeakAlive](TSharedPtr<FJsonObject>)
	{
		if (WeakAlive.IsValid())
		{
			bStateRequestInFlight = false;
		}
	});
}

// ---------------------------------------------------------------------------------------------------
// Fil de la tour : notifications

void FAlkatrazzTowerModule::PollFeed()
{
	if (bFeedRequestInFlight)
	{
		return;
	}
	bFeedRequestInFlight = true;
	TWeakPtr<bool> WeakAlive = Alive;
	const FString Path = FString(TEXT("/api/editor/feed?project=")) + FGenericPlatformHttp::UrlEncode(ProjectName());
	TowerClient::Get(Path, [this, WeakAlive](TSharedPtr<FJsonObject> Feed)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		bFeedRequestInFlight = false;
		if (Feed.IsValid())
		{
			HandleFeed(Feed);
		}
	});
}

void FAlkatrazzTowerModule::HandleFeed(const TSharedPtr<FJsonObject>& Feed)
{
	// 1. Agents qui attendent une reponse
	TSet<FString> NowWaiting;
	const TArray<TSharedPtr<FJsonValue>>* Agents = nullptr;
	if (Feed->TryGetArrayField(TEXT("agents"), Agents) && Agents)
	{
		for (const TSharedPtr<FJsonValue>& Value : *Agents)
		{
			const TSharedPtr<FJsonObject>* Agent = nullptr;
			if (!Value.IsValid() || !Value->TryGetObject(Agent) || !Agent || !Agent->IsValid())
			{
				continue;
			}
			FString Status, SessionId, Name, Message;
			(*Agent)->TryGetStringField(TEXT("status"), Status);
			(*Agent)->TryGetStringField(TEXT("sessionId"), SessionId);
			(*Agent)->TryGetStringField(TEXT("name"), Name);
			(*Agent)->TryGetStringField(TEXT("message"), Message);
			if (Status != TEXT("waiting"))
			{
				continue;
			}
			NowWaiting.Add(SessionId);
			if (bFeedPrimed && !WaitingAgents.Contains(SessionId))
			{
				Notify(FText::Format(LOCTEXT("AgentWaiting", "{0} attend ta reponse : {1}"), FText::FromString(Name), FText::FromString(Message.Left(160))),
					SNotificationItem::CS_Pending, true);
			}
		}
	}
	WaitingAgents = MoveTemp(NowWaiting);

	// 2. Dernier build termine
	const TSharedPtr<FJsonObject>* LastBuild = nullptr;
	if (Feed->TryGetObjectField(TEXT("lastBuild"), LastBuild) && LastBuild && LastBuild->IsValid())
	{
		FString Id, Label, Kind, Summary, BuildSession;
		bool bOk = true;
		(*LastBuild)->TryGetStringField(TEXT("sessionId"), BuildSession);
		(*LastBuild)->TryGetStringField(TEXT("id"), Id);
		(*LastBuild)->TryGetStringField(TEXT("label"), Label);
		(*LastBuild)->TryGetStringField(TEXT("kind"), Kind);
		(*LastBuild)->TryGetStringField(TEXT("summary"), Summary);
		(*LastBuild)->TryGetBoolField(TEXT("ok"), bOk);
		// Les compilations Live Coding de cet editeur, on les a deja vues passer.
		if (bFeedPrimed && !Id.IsEmpty() && Id != LastBuildId && !BuildSession.StartsWith(TEXT("editor:")))
		{
			if (!bOk)
			{
				Notify(FText::Format(LOCTEXT("BuildFailed", "Echec ({0}) de {1} : {2}"), FText::FromString(Kind), FText::FromString(Label), FText::FromString(Summary)),
					SNotificationItem::CS_Fail, true);
			}
			else if (Kind == TEXT("package"))
			{
				Notify(FText::Format(LOCTEXT("PackageOk", "Package reussi ({0})"), FText::FromString(Label)), SNotificationItem::CS_Success, true);
			}
		}
		LastBuildId = Id;
	}

	// 3. Un agent prend le verrou de compilation : pas de Live Coding pendant ce temps.
	const TSharedPtr<FJsonObject>* Lock = nullptr;
	FString LockSession;
	if (Feed->TryGetObjectField(TEXT("lock"), Lock) && Lock && Lock->IsValid())
	{
		FString Label, Kind;
		(*Lock)->TryGetStringField(TEXT("sessionId"), LockSession);
		(*Lock)->TryGetStringField(TEXT("label"), Label);
		(*Lock)->TryGetStringField(TEXT("kind"), Kind);
		if (bFeedPrimed && LockSession != LastLockSession && !LockSession.StartsWith(TEXT("editor:")))
		{
			Notify(FText::Format(LOCTEXT("AgentBuilding", "{0} lance : {1}. Evite Live Coding jusqu'a la fin."), FText::FromString(Label), FText::FromString(Kind)),
				SNotificationItem::CS_Pending, false);
		}
	}
	LastLockSession = LockSession;

	// 4. Version validee
	const TSharedPtr<FJsonObject>* Version = nullptr;
	if (Feed->TryGetObjectField(TEXT("version"), Version) && Version && Version->IsValid())
	{
		bool bWon = false;
		FString Name;
		(*Version)->TryGetBoolField(TEXT("won"), bWon);
		(*Version)->TryGetStringField(TEXT("name"), Name);
		if (bFeedPrimed && bWon && !bVersionWon)
		{
			Notify(FText::Format(LOCTEXT("VersionWon", "Version {0} validee !"), FText::FromString(Name)), SNotificationItem::CS_Success, true);
		}
		bVersionWon = bWon;
	}

	bFeedPrimed = true;
}

// ---------------------------------------------------------------------------------------------------
// Live Coding sous le verrou de la tour

void FAlkatrazzTowerModule::WatchLiveCoding(double Now)
{
#if WITH_LIVE_CODING
	ILiveCodingModule* LiveCoding = FModuleManager::GetModulePtr<ILiveCodingModule>(LIVE_CODING_MODULE_NAME);
	if (LiveCoding && !PatchCompleteHandle.IsValid())
	{
		PatchCompleteHandle = LiveCoding->GetOnPatchCompleteDelegate().AddLambda([this]() { bPatchApplied = true; });
	}
	const bool bCompiling = LiveCoding && LiveCoding->IsCompiling();

	if (bCompiling && !bWasCompiling)
	{
		// Debut d'une compilation (Ctrl+Alt+F11 ou bouton) : on prend un ticket comme un agent.
		bPatchApplied = false;
		CompileStartedAt = Now;
		LastHeartbeat = Now;
		if (LiveCodingLog.IsValid())
		{
			LiveCodingLog->Start();
		}
		TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
		Body->SetStringField(TEXT("sessionId"), EditorSessionId());
		Body->SetStringField(TEXT("kind"), TEXT("livecoding"));
		Body->SetStringField(TEXT("command"), TEXT("Live Coding (editeur Unreal)"));
		Body->SetStringField(TEXT("cwd"), FPaths::ConvertRelativePathToFull(FPaths::ProjectDir()));
		Body->SetNumberField(TEXT("pid"), FPlatformProcess::GetCurrentProcessId());
		TWeakPtr<bool> WeakAlive = Alive;
		TowerClient::Post(TEXT("/api/lock/acquire"), Body, [this, WeakAlive](TSharedPtr<FJsonObject> Response)
		{
			if (!WeakAlive.IsValid() || !Response.IsValid())
			{
				return;
			}
			FString Ticket;
			if (!Response->TryGetStringField(TEXT("ticket"), Ticket))
			{
				return;
			}
			LiveCodingTicket = Ticket;
			bool bGranted = false;
			Response->TryGetBoolField(TEXT("granted"), bGranted);
			if (!bGranted)
			{
				FString Holder;
				const TSharedPtr<FJsonObject>* HolderObject = nullptr;
				if (Response->TryGetObjectField(TEXT("holder"), HolderObject) && HolderObject && HolderObject->IsValid())
				{
					(*HolderObject)->TryGetStringField(TEXT("label"), Holder);
				}
				Notify(FText::Format(LOCTEXT("LiveCodingBusy", "Live Coding pendant une compilation de {0} : il risque d'echouer. Relance-le quand la forge est libre."),
					FText::FromString(Holder.IsEmpty() ? TEXT("un agent") : Holder)), SNotificationItem::CS_Fail, true);
			}
			if (!bWasCompiling)
			{
				// La compilation a fini avant la reponse de la tour.
				ReleaseLiveCoding();
			}
		});
	}
	else if (!bCompiling && bWasCompiling)
	{
		ReleaseLiveCoding();
	}
	else if (bCompiling && !LiveCodingTicket.IsEmpty() && Now - LastHeartbeat >= 5.0)
	{
		LastHeartbeat = Now;
		TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
		Body->SetStringField(TEXT("ticket"), LiveCodingTicket);
		TowerClient::Post(TEXT("/api/lock/heartbeat"), Body);
	}
	bWasCompiling = bCompiling;
#endif
}

void FAlkatrazzTowerModule::ReleaseLiveCoding()
{
	if (LiveCodingTicket.IsEmpty())
	{
		return;
	}
	bool bError = false;
	bool bSuccess = false;
	TArray<FString> Errors;
	if (LiveCodingLog.IsValid())
	{
		LiveCodingLog->Stop(bError, bSuccess, Errors);
	}
	const bool bPatch = bPatchApplied;
	const bool bOk = !bError || bPatch;
	FString Summary = bPatch ? TEXT("patch applique") : (bError ? TEXT("echec de compilation") : TEXT("aucun changement"));

	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetBoolField(TEXT("ok"), bOk);
	Result->SetNumberField(TEXT("exitCode"), bOk ? 0 : 1);
	Result->SetStringField(TEXT("summary"), Summary);
	Result->SetNumberField(TEXT("errors"), Errors.Num());
	TArray<TSharedPtr<FJsonValue>> ErrorValues;
	for (const FString& Line : Errors)
	{
		ErrorValues.Add(MakeShared<FJsonValueString>(Line));
	}
	Result->SetArrayField(TEXT("errorLines"), ErrorValues);
	Result->SetNumberField(TEXT("durationMs"), (FPlatformTime::Seconds() - CompileStartedAt) * 1000.0);

	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("ticket"), LiveCodingTicket);
	Body->SetObjectField(TEXT("result"), TSharedPtr<FJsonObject>(Result));
	TowerClient::Post(TEXT("/api/lock/release"), Body);
	LiveCodingTicket.Reset();
}

// ---------------------------------------------------------------------------------------------------
// Assets : carte en direct, et l'asset ouvert qu'un agent modifie

void FAlkatrazzTowerModule::FlushAssetChanges(double Now)
{
	// Pendant le premier balayage du registre, chaque asset "arrive" : on attend la fin.
	if (IAssetRegistry* AssetRegistry = IAssetRegistry::Get())
	{
		if (AssetRegistry->IsLoadingAssets())
		{
			return;
		}
	}
	LastAssetFlush = Now;
	bAssetsChanged = false;

	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("project"), ProjectName());
	{
		FScopeLock Lock(&SavedMutex);
		if (!LastSavedPackage.IsEmpty())
		{
			Body->SetStringField(TEXT("saved"), LastSavedPackage);
			LastSavedPackage.Reset();
		}
	}
	TowerClient::Post(TEXT("/api/editor/assets-changed"), Body);
}

void FAlkatrazzTowerModule::OnAssetOpened(UObject* Asset, IAssetEditorInstance* Editor)
{
	if (!Asset)
	{
		return;
	}
	UPackage* Package = Asset->GetPackage();
	if (!Package)
	{
		return;
	}
	const FString LongName = Package->GetName();
	if (!LongName.StartsWith(TEXT("/Game/")))
	{
		return;
	}
	FString File;
	const FString& Extension = Asset->IsA<UWorld>() ? FPackageName::GetMapPackageExtension() : FPackageName::GetAssetPackageExtension();
	if (!FPackageName::TryConvertLongPackageNameToFilename(LongName, File, Extension))
	{
		return;
	}

	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("project"), ProjectName());
	Body->SetStringField(TEXT("file"), FPaths::ConvertRelativePathToFull(File));
	Body->SetStringField(TEXT("package"), LongName);
	const FString AssetName = Asset->GetName();
	TWeakPtr<bool> WeakAlive = Alive;
	TowerClient::Post(TEXT("/api/editor/asset-opened"), Body, [this, WeakAlive, AssetName](TSharedPtr<FJsonObject> Response)
	{
		const TArray<TSharedPtr<FJsonValue>>* Agents = nullptr;
		if (!WeakAlive.IsValid() || !Response.IsValid() || !Response->TryGetArrayField(TEXT("agents"), Agents) || !Agents || Agents->Num() == 0)
		{
			return;
		}
		TArray<FString> Names;
		for (const TSharedPtr<FJsonValue>& Value : *Agents)
		{
			const TSharedPtr<FJsonObject>* Agent = nullptr;
			FString Name;
			if (Value.IsValid() && Value->TryGetObject(Agent) && Agent && Agent->IsValid() && (*Agent)->TryGetStringField(TEXT("name"), Name))
			{
				Names.Add(Name);
			}
		}
		if (Names.Num() > 0)
		{
			Notify(FText::Format(LOCTEXT("AssetBusy", "Attention : {0} travaille sur {1} en ce moment. Vos changements pourraient se croiser."),
				FText::FromString(FString::Join(Names, TEXT(", "))), FText::FromString(AssetName)), SNotificationItem::CS_Fail, true);
		}
	});
}

#undef LOCTEXT_NAMESPACE
